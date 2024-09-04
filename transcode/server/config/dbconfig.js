const mongoose=require('mongoose')
const URL="mongodb+srv://jaris23:jaris@cluster0.5aczo7e.mongodb.net/Mentwis"
mongoose.connect(URL)
const db=mongoose.connection;

db.on('connected',()=>{
    console.log("MongoDB connection Successful")
})

db.on('error',()=>{
    console.log("MongoDB connection Failed")
})
module.exports=db