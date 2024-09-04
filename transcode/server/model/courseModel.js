const mongoose=require('mongoose')
const { Schema } = mongoose;

const { ObjectId } = mongoose.Schema;

const SubtitleSchema = new mongoose.Schema({
  language: { type: String, required: true },
  fileKey: { type: String, required: true },
  fileUrl: { type: String, required: true }
});
const lessonSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
      minlength: 3,
      maxlength: 320,
      required: true,
    },
    slug: {
      type: String,
      lowercase: true,
    },
    
    content: {
      type: {},
      minlength: 200,
    },
    duration:{
      type:Number,
      
    },
    videos: {
     
    },
   
    free_preview: {
      type: Boolean,
      default: false,
    },
    subtitles: { type: [SubtitleSchema], default: [] }

  },
  { timestamps: true }
);
const chapterSchema=new mongoose.Schema({
  title:{
  type:String,
  required:true
  },
  lessons:[lessonSchema]
  
  },{
    timestamps:true
  })


const courseSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      minlength: 3,
      maxlength: 320,
      required: true,
    },
    title_id:{
     type:String
    },
    language:{
      type:String,
      required:true
    },
    slug: {
      type: String,
      lowercase: true,
    },
    topicdescription:{
      type: {},
      minlength: 200,
      required: true
    },
    description: {
      type: {},
      minlength: 200,
      required: true,
    },
    whoneeds:{
      type: {},
      minlength: 200,
      required: true,
    },
    outcomes:{
      type:{},
      minlength: 200,
      required: true
    },
    requirements:{
      type: {},
      minlength: 200,
      required: true,
    },
    price: {
      type: Number,
      default: 100,
    },
    image: {},
    category: String,
    published: {
      type: Boolean,
      default: false,
    },
    paid: {
      type: Boolean,
      default: true,
    },
    mentor: {
      type: ObjectId,
      ref: "User",
      required: true,
    },
    courseDuration:{
      type:Number,
    },
    enrolledUsers:[{
      type:ObjectId,
      ref:"User"
    }],
   earnings:{
    type:Number
   },
    chapters:[chapterSchema]
    
  },
  { timestamps: true }
);



module.exports= mongoose.model("Course", courseSchema);
