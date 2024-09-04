const mongoose=require('mongoose')
const { ObjectId } = mongoose.Schema;
const userSchema=new mongoose.Schema({
    name:{
       type:String,
       trim:true,
       required:true
    },
    paramssname:{
    type:String,
    trim:true,
    unique:true,
    lowercase:true
    },
    email:{
      type:String,
      trim:true,
      unique:true,
      required:true
    },
    password:{
     type:String,
     min:6,
     max:64,
     required:true
    },
    bio: {
      type: {},
      minlength: 200,
    },
    profilepic: {},
    coverpic:{},
    picture:{
      type:String,
      default:"/avatar.png"
    },
    role:{
      type:[String],
      default:["User"],
      enum:["User","Mentor","Admin"]
    },
    passwordResetCode:{
      type:String,
      default:""
    },
    courses:[
      {
        type:ObjectId,
        ref:"Courses"
      }
    ],
    meetings:[
      {
        type:ObjectId,
        ref:"Meeting"
      }
    ],
    mentor_meetings:[{
      type:ObjectId,
      ref:"Meeting"
    }],
    published_Courses:[{
      type:ObjectId,
      ref:"Courses"
    }],
   razorpay_acc_id:{
    type:String
   },
   razorpay_stakeholder_id:{
    type:String
   },
   razorpay_product_id:{
    type:String
   },
   account_number:{
   type:String
   },
   ifsc_code:{
    type:String
   },
   beneficiary_name:{
    type:String
   }
},
{
    timestamps:true
})

const User = mongoose.model('User', userSchema);

module.exports=User;