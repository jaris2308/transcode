const express = require('express');
const dbConfig = require('./config/dbconfig');
const Course = require('./model/courseModel.js');
const User = require('./model/userModel.js');
const AWS = require('aws-sdk');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const slugify = require('slugify');
const http = require('http');
require('dotenv').config();

ffmpeg.setFfmpegPath(ffmpegPath);


const ACCESS_KEY = process.env.ACCESS_KEY;
const SECRET_KEY = process.env.SECRET_KEY;
const REGION = process.env.REGION;
const API_VERSION = process.env.API_VERSION;
const BUCKET_NAME=process.env.BUCKET_NAME
const mp4FileName = process.env.mp4FileName;

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
const ec2 = new AWS.EC2({ region: REGION });

const folderPath=uuidv4()
const outputDir = 'output';

const converttoHLS = async (lessontitle,duration,courseId) => {
    console.log("HLS:------")
    const resolutions = [
        {
            resolution: '640x360',  
            videoBitrate: '800k',   
            audioBitrate: '96k'     
        },
        {
            resolution: '854x480',  
            videoBitrate: '1200k',  
            audioBitrate: '128k'    
        },
        {
            resolution: '1280x720', 
            videoBitrate: '2500k',  
            audioBitrate: '192k'    
        },
        {
            resolution: '1920x1080', 
            videoBitrate: '4500k',   
            audioBitrate: '256k'   
        },
    ];


   
   
    const variantPlaylists = [];

    // Ensure the output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    for (const { resolution, videoBitrate, audioBitrate } of resolutions) {
        const outputFileName = `${mp4FileName.replace('.', '_')}_${resolution}.m3u8`;
        const segmentFileName = `${mp4FileName.replace('.', '_')}_${resolution}_%03d.ts`;

        await new Promise((resolve, reject) => {
            ffmpeg(mp4FileName)
                .outputOptions([
                    `-c:v h264`,
                    `-b:v ${videoBitrate}`,
                    `-c:a aac`,
                    `-b:a ${audioBitrate}`,
                    `-vf scale=${resolution}`,
                    `-f hls`,
                    `-hls_time 10`,
                    `-hls_list_size 0`,
                    `-hls_segment_filename ${path.join(outputDir, segmentFileName)}`
                ])
                .output(path.join(outputDir, outputFileName))
                .on('end', async () => {
                    try {
                        const newOne=fs.readdirSync(outputDir);
                        console.log("NEW ONE:--",newOne)
                            console.log('Files in output directory:', fs.readdirSync(outputDir))
                       await uploadToS3(path.join(outputDir, newOne[1]),newOne[1])
                        await uploadToS3(path.join(outputDir, outputFileName), outputFileName);
                        
    
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                })
                .on('error', (err) => reject(err))
                .run();
        });

        variantPlaylists.push({
            resolution,
            outputFileName
        });
    }

    const bandwidthMap = {
        '640x360': 800000,  
        '854x480': 1200000, 
        '1280x720': 2500000,
        '1920x1080': 4500000 
    };

    let masterPlaylist = variantPlaylists.map(({ resolution, outputFileName }) => {
        const bandwidth = bandwidthMap[resolution] || 0;

        return `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},RESOLUTION=${resolution}\n${outputFileName}`;
    }).join('\n');
    masterPlaylist = `#EXTM3U\n${masterPlaylist}`;

    const masterPlaylistFileName = `${mp4FileName.replace('.', '_')}_master.m3u8`;
    const masterPlaylistPath = path.join(outputDir, masterPlaylistFileName);
    fs.writeFileSync(masterPlaylistPath, masterPlaylist);
    await uploadToS3(masterPlaylistPath, masterPlaylistFileName);
};
async function parseS3Url(url) {
    const regexVirtualHost = /^https:\/\/([^\.]+)\.s3\.(.+?)\.amazonaws\.com\/(.+)$/;
    const regexPathStyle = /^https:\/\/s3\.(.+?)\.amazonaws\.com\/([^\/]+)\/(.+)$/;
  
    let match = url.match(regexVirtualHost);
    if (match) {
      return {
        bucket: match[1],
        key: match[3]
      };
    }
  
    match = url.match(regexPathStyle);
    if (match) {
      return {
        bucket: match[2],
        key: match[3]
      };
    }
  
    throw new Error('Invalid S3 URL format');
  }
  const uploadToS3 = async (filePath, key) => {
    const fileStream = fs.createReadStream(filePath);
   
    const normalizedFolderPath = folderPath.endsWith('/') ? folderPath : `${folderPath}/`;
    
    // Upload parameters
    const uploadParams = {
        Bucket:`${BUCKET_NAME}`,
        Key: `${normalizedFolderPath}${key}`,
        Body: fileStream,
    };

    return S3.upload(uploadParams).promise();
};
  
  const downloadVideo = (key, bucketName,downloadPath) => {
    const params = {
      Bucket:bucketName,
      Key: key
    };
  
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(downloadPath);
      S3.getObject(params)
        .createReadStream()
        .pipe(file)
        .on('finish', () => resolve(downloadPath))
        .on('error', reject);
    });
  };
  const callResolution = async () => {
    let queues = [];
    let queuesize = 0;
    queues = await getAllQueueURL();
    console.log("QE=UEUES:--",queues)
    for (let i = 0; i < queues.length; i++) {
        queuesize = await getQueueSize(queues[i]);
        if (queuesize > 0) {
            await startTranscode(queues[i]);
        }
        if (queuesize === 0) {
            await terminateInstance();
        }
    }
}

const startTranscode=async(queueUrl)=>{
    
    const data = await sqs.receiveMessage({
        QueueUrl: queueUrl,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 43200,
        WaitTimeSeconds: 20
    }).promise();


    console.log("DATA:------",data)
    for (let i = 0; i < data.Messages.length; i++) {
        const message = data.Messages[i];
        const messageBody = JSON.parse(message.Body);

        const localInputPath = await parseS3Url(messageBody.videoKey);

        console.log(localInputPath)
        const tempbucketName=localInputPath.bucket;
        const key=localInputPath.key
        const downloadPath = path.join(__dirname, mp4FileName);
        await downloadVideo(key,tempbucketName,downloadPath)
        await converttoHLS()
        const videoUrls = {
            '360p': `https://${BUCKET_NAME}.s3.ap-south-1.amazonaws.com/${folderPath}/${mp4FileName}_640x360.m3u8`,
            '480p': `https://${BUCKET_NAME}.s3.ap-south-1.amazonaws.com/${folderPath}/${mp4FileName}_854x480.m3u8`,
            '720p': `https://${BUCKET_NAME}.s3.ap-south-1.amazonaws.com/${folderPath}/${mp4FileName}_1280x720.m3u8`,
            '1080p': `https://${BUCKET_NAME}.s3.ap-south-1.amazonaws.com/${folderPath}/${mp4FileName}_1920x1080.m3u8`,
            'Auto': `https://${BUCKET_NAME}.s3.ap-south-1.amazonaws.com/${folderPath}/${mp4FileName}_master.m3u8`
        };
        
        
        const course = await Course.findOne({ title_id: messageBody.courseId });
        if (course) {
            const chapter = course.chapters.find(chap => chap._id.toString() === messageBody.chapterId);
            if (chapter) {
                const newLesson = {
                    title: messageBody.lessontitle,
                    videos: videoUrls,
                    duration: messageBody.durationInSeconds,
                    slug: slugify(messageBody.lessontitle)
                };
        
                chapter.lessons.push(newLesson);
                await course.save();
        
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
        
                const result = await Course.aggregate(aggregationPipeline);
        
                if (result.length > 0) {
                    const totalDuration = result[0].totalDuration;
                    await Course.findOneAndUpdate(
                        { title_id: messageBody.courseId },
                        { $set: { courseDuration: totalDuration } },
                        { new: true }
                    ).populate("mentor", "_id name").exec();
                }
            }
        }
        const bucketParams = {
            Bucket: tempbucketName,
            Key:key
        };
        await S3.deleteObject(bucketParams).promise();

        await sqs.deleteMessage({
            QueueUrl: queueUrl,
            ReceiptHandle: message.ReceiptHandle
        }).promise();

        fs.unlink(downloadPath, (err) => {
            if (err) {
                console.error('Error deleting file:', err);
                return;
            }
            console.log('File deleted successfully');
        });

        fs.rm(outputDir, { recursive: true, force: true }, (err) => {
            if (err) {
                console.error('Error deleting directory and its contents:', err);
                return;
            }
            console.log('Directory and its contents deleted successfully');
        });
        }
        callResolution()
}

const getAllQueueURL = async () => {
    try {
        const response = await sqs.listQueues().promise();
        return response.QueueUrls || [];
    } catch (error) {
        console.error('Error retrieving queues:', error);
        return [];
    }
}

async function getQueueSize(queueUrl) {
    try {
        const params = {
            QueueUrl: queueUrl,
            AttributeNames: ['ApproximateNumberOfMessages']
        };
        const data = await sqs.getQueueAttributes(params).promise();
        return parseInt(data.Attributes['ApproximateNumberOfMessages'], 10);
    } catch (err) {
        console.error('Error fetching queue size:', err);
        throw err;
    }
}
async function terminateInstance() {
    try {
        const instanceId = await getInstanceId();

        console.log("Instance ID:--------",instanceId)
        const params = {
            InstanceIds: [instanceId]
        };
        const data = await ec2.terminateInstances(params).promise();

        console.log("Terminate Instance:------",data)
        await ec2.waitFor('instanceTerminated', { InstanceIds: [instanceId] }).promise();
    } catch (err) {
        console.error('Error terminating instance:', err);
    }
}

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

callResolution()



