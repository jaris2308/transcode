const express = require('express');
const dbConfig = require('./config/dbconfig');
const  Course  =require('./model/courseModel.js')
const  User  =require('./model/userModel.js')
const AWS=require('aws-sdk')
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const slugify=require('slugify')
require('dotenv').config();
ffmpeg.setFfmpegPath(ffmpegPath);

const decodeURIComponentSafe = (str) => decodeURIComponent(str.replace(/\+/g, '%20'));
let tempbucket;

const ACCESS_KEY=process.env.ACCESS_KEY
const SECRET_KEY=process.env.SECRET_KEY
const REGION=process.env.REGION
const API_VERSION=process.env.API_VERSION

const awsConfig = {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    region: REGION,
    apiVersion: API_VERSION
};

const sqsConfig = {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
    region: REGION,
    apiVersion: '2012-11-05'
};

const S3 = new AWS.S3(awsConfig);
const sqs = new AWS.SQS(sqsConfig);
const ec2 =new AWS.EC2({region:REGION})


console.log("REGION:_-----",REGION)
console.log("SECRET KEY:----",SECRET_KEY)
console.log("ACCESS KEY:---",ACCESS_KEY)


const ensureDirectoryExists = async (dirPath) => {
    return new Promise((resolve, reject) => {
        fs.mkdir(dirPath, { recursive: true }, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
};





async function downloadInputFromS3(inputS3Url) {
    console.log("Input S3 URL:", inputS3Url);

    const tempDir = path.join(__dirname, '..', '..', 'temp');
    await ensureDirectoryExists(tempDir);

    const bucketName = inputS3Url.split('/')[2].split('.')[0];
    let objectKey = inputS3Url.split('/').slice(3).join('/');
    objectKey = decodeURIComponentSafe(objectKey);

    const params = {
        Bucket: bucketName,
        Key: objectKey
    };
    console.log("Params:", params);

    const filePath = path.join(tempDir, 'input.mp4');
    const fileWriteStream = fs.createWriteStream(filePath);

    return new Promise((resolve, reject) => {
        const s3Stream = S3.getObject(params).createReadStream();

        s3Stream.on('error', reject);
        fileWriteStream.on('error', reject);
        fileWriteStream.on('close', () => resolve(filePath));

        s3Stream.pipe(fileWriteStream);
    });
}


function getResolutionDimensions(resolution) {
    switch (resolution) {
        case '1080':
            return { dimensions: '1920:1080', bandwidth: '5000000' };
        case '720':
            return { dimensions: '1280:720', bandwidth: '2500000' };
        case '480':
            return { dimensions: '854:480', bandwidth: '1000000' };
        case '360':
            return { dimensions: '640:360', bandwidth: '500000' };
        default:
            throw new Error('Unsupported resolution');
    }
}


function transcodeToResolution(inputPath, outputPath, resolution) {
    const { dimensions, bandwidth } = getResolutionDimensions(resolution);
    const outputDir = path.dirname(outputPath);

    return new Promise((resolve, reject) => {
        ensureDirectoryExists(outputDir)
            .then(() => {
                console.log(`Starting transcoding to ${resolution}p with dimensions ${dimensions}...`);
                ffmpeg()
                    .input(inputPath)
                    .videoCodec('libx264')
                    .outputOptions('-preset ultrafast')
                    .audioCodec('aac')
                    .videoFilters(`scale=${dimensions}`)
                    .output(outputPath)
                    .format('hls')
                    .outputOptions('-hls_time 10') 
                    .outputOptions('-hls_list_size 0') 
                    .outputOptions('-hls_flags independent_segments') 
                    .outputOptions('-b:v', bandwidth) 
                    .on('end', () => {
                        console.log(`Transcoding to ${resolution}p complete.`);
                        resolve(outputPath);
                    })
                    .on('error', (err) => {
                        console.error(`Error transcoding to ${resolution}p:`, err);
                        reject(err);
                    })
                    .run();
            })
            .catch(reject);
    });
}

function generateMasterPlaylist(outputDir, resolutions) {
    const masterPlaylistPath = path.join(outputDir, 'master.m3u8');
    const playlistLines = [
        '#EXTM3U',
        '#EXT-X-VERSION:3'
    ];

    resolutions.forEach(({ resolution, filename }) => {
        const { bandwidth, dimensions } = getResolutionDimensions(resolution);
        const resolutionLine = `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${dimensions}`;
        const uriLine = filename;
        playlistLines.push(resolutionLine, uriLine);
    });

    return new Promise((resolve, reject) => {
        fs.writeFile(masterPlaylistPath, playlistLines.join('\n'), (err) => {
            if (err) reject(err);
            else resolve(masterPlaylistPath);
        });
    });
}


async function uploadFileToS3(filePath, bucketName, key) {
    console.log("Uploading file:", filePath);
    const fileContent = fs.readFileSync(filePath);

    const params = {
        Bucket: bucketName,
        Key: key,
        Body: fileContent
    };

    return S3.upload(params).promise().then(data => data.Location);
}


async function transcodeToAllResolutions(queueUrl) {
    const tempFiles = [];
    try { 
        console.log("transcoede to all resolutions",queueUrl)
         const data = await sqs.receiveMessage({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 1,
          VisibilityTimeout: 25000,
          WaitTimeSeconds: 20
        }).promise();
        console.log("All recieved messages-----------------------",data)
          const message = data.Messages[0];
         
          console.log('Received message:', message);
          const messageBody = JSON.parse(message.Body); 
      
         
          console.log('Received message body:', messageBody);

        tempbucket=messageBody.videoKey
           const  localInputPath = await downloadInputFromS3(messageBody.videoKey);
        console.log("LocalInputPath",localInputPath)
        tempFiles.push(localInputPath);

        const resolutions = [
            { resolution: '1080', filename: `output_1080p_${uuidv4()}.m3u8` },
            { resolution: '720', filename: `output_720p_${uuidv4()}.m3u8` },
            { resolution: '480', filename: `output_480p_${uuidv4()}.m3u8` },
            { resolution: '360', filename: `output_360p_${uuidv4()}.m3u8` }
        ];

        const outputDir = path.join(__dirname, 'sample');
        await ensureDirectoryExists(outputDir);

        const transcodingTasks = resolutions.map(({ resolution, filename }) => {
            const outputPath = path.join(outputDir, filename);
          
            return transcodeToResolution(localInputPath, outputPath, resolution);
        });

        const transcodedFiles = await Promise.all(transcodingTasks);

        const masterPlaylistPath = await generateMasterPlaylist(outputDir, resolutions);
       

        const uploadTasks = [...transcodedFiles, masterPlaylistPath].map(filePath => {
            const fileName = path.basename(filePath);
            return uploadFileToS3(filePath, 'transcodeedvideos', fileName);
        });

        const uploadResults = await Promise.all(uploadTasks);
        console.log('All HLS segments and master playlist uploaded to S3:', uploadResults);

        const videoUrls = {
            '360p': uploadResults[3],
            '480p': uploadResults[2],
            '720p': uploadResults[1],
            '1080p': uploadResults[0],
            'Auto': uploadResults[4]
        };
        console.log('Video URLs:', videoUrls);
                    const course=await Course.findOne({title_id:messageBody.courseId})
            console.log("Course:------",course)
             console.log("ChapterId:------",course.chapters[messageBody.chapterNumber]._id)
          
           
            const chapter=course.chapters[messageBody.chapterNumber]._id.toString()===messageBody.chapterId
console.log("Chapter:-----",chapter)
            if (chapter) {
              
            
          
        
            const newLesson = {
              title:messageBody.lessontitle,
              videos:videoUrls,
              duration:messageBody.durationInSeconds,
              slug: slugify(messageBody.lessontitle) 
            };
          console.log("New Lesson:---------",newLesson)
            
            course.chapters[messageBody.chapterNumber].lessons.push(newLesson);
          
           
             await course.save();

             console.log("Before Aggregration")
             const aggregationPipeline = [
              { $match: { title_id: messageBody.courseId } },
              { $unwind: '$chapters' }, 
              { $unwind: '$chapters.lessons' }, 
              {
                $group: {
                  _id: '$_id',
                  totalDuration: { $sum: '$chapters.lessons.duration' }
                }
              }
            ];
          console.log("Before result")
            const result = await Course.aggregate(aggregationPipeline);
            console.log("After result")
          
            if (result.length > 0) {
              const totalDuration = result[0].totalDuration;
             console.log("Total Duration",totalDuration)
              const updatedCourse = await Course.findOneAndUpdate(
                { title_id: messageBody.courseId },
                { $set: { courseDuration: totalDuration } },
                { new: true }
              ).populate("mentor", "_id name").exec();

              console.log("Updated Course:-----",updatedCourse)
          
            }
          }
       
            fs.unlinkSync(localInputPath);
            transcodedFiles.forEach(file => fs.unlinkSync(file));


            const bucketName = tempbucket.split('/')[2].split('.')[0];
            let objectKey = tempbucket.split('/').slice(3).join('/');
            objectKey = decodeURIComponentSafe(objectKey);
        
            const params = {
                Bucket: bucketName,
                Key: objectKey
            };
             
                await S3.deleteObject(params).promise();



  
            await sqs.deleteMessage({
              QueueUrl: queueUrl,
              ReceiptHandle: message.ReceiptHandle
            }).promise();

            console.log("SUCCESS")
            await terminateInstance()

    } catch (err) {
        console.error('Error processing video:', err);
    }
}
const callResolution=async()=>{
    console.log("Inside call resolution")
    let queues=[];
    let queuesize=0;
    queues=await getAllqueueURL()
    for(let i=0;i<queues.length;i++)
        {
           queuesize= await getQueueSize(queues[i])
           if(queuesize>0)
           {
            await transcodeToAllResolutions(queues[i])
           }
           if(queuesize===0)
           {
            await deleteQueue(queues[i])
           }
        }
  }
  
   const getAllqueueURL=async()=>{
    try {
  
  
        const response = await sqs.listQueues().promise();
        if (response.QueueUrls && response.QueueUrls.length > 0) {
          
            const queueUrls = response.QueueUrls;
            return queueUrls; 
          
        } else {
          return []
        }
      } catch (error) {
        console.error('Error retrieving queues:', error);
       
      }
  }
  async function getQueueSize(queueUrl) {
    try {
        const params = {
            QueueUrl: queueUrl,
            AttributeNames: ['ApproximateNumberOfMessages']
        };
        const data = await sqs.getQueueAttributes(params).promise();
        const queueSize = data.Attributes['ApproximateNumberOfMessages'];
        console.log(`Queue Size for ${queueUrl}:`, queueSize);
        return parseInt(queueSize); 
    } catch (err) {
        console.error('Error fetching queue size:', err);
        throw err;
    }
  }
  async function deleteQueue(queueUrl) {
    try {
      const params = {
        QueueUrl: queueUrl
      };
  
      const data = await sqs.deleteQueue(params).promise();
      console.log(`Queue deleted successfully: ${queueUrl}`);
      return data;
    } catch (err) {
      console.error('Error deleting queue:', err);
      throw err;
    }
  }

  callResolution()
  


function getInstanceId() {
    return new Promise((resolve, reject) => {
        http.get('http://169.254.169.254/latest/meta-data/instance-id', (resp) => {
            let data = '';
            resp.on('data', (chunk) => {
                data += chunk;
            });
            resp.on('end', () => {
                resolve(data);
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}


async function terminateInstance() {
    try {

        const instanceId = await getInstanceId();
        console.log(`Terminating instance with ID: ${instanceId}`);


        const params = {
            InstanceIds: [instanceId]
        };
        const data = await ec2.terminateInstances(params).promise();
        console.log('Termination request sent:', data);

    
        await ec2.waitFor('instanceTerminated', { InstanceIds: [instanceId] }).promise();
        console.log('Instance terminated successfully.');
    } catch (err) {
        console.error('Error terminating instance:', err);
    }
}


