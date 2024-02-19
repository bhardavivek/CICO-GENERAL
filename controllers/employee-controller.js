const jwt = require('jsonwebtoken');
const User = require('../model/user.model');
const nodemailer = require('nodemailer');
const CryptoJS = require('crypto-js');
const fs = require('fs');
const path = require('path');
const handlebars = require('handlebars');



// This functiuon is for login and generate jwt token
const userLogin = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(204).json({ msg: "email and password are required" })
        }
        const userDetails = await User.findOne({ email: email })
        if (!userDetails) {
            return res.status(404).json({ msg: "User not found" })
        }
        const bytes = CryptoJS.AES.decrypt(userDetails.password, 'cico-general');
        const isPasswordCorrect = bytes.toString(CryptoJS.enc.Utf8);
        if (isPasswordCorrect !== password) {
            return res.status(500).json({ msg: "Password is incorrect!" })
        }
        if (userDetails.isVerified) {

            const token = jwt.sign({
                exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, //  8 hours for token expire
                id: userDetails._id,
            }, process.env.SECRET_KEY);
            res.cookie('access_token', token, {
                expires: new Date(Date.now() + 28800000), //   8 hours for token expire
                httpOnly: true
            });
            // create payload for giving response in the client-side.
            const userdata = {
                token: token,
                id: userDetails._id,
                user_display_name: userDetails.firstName + userDetails.lastName,
                phoneNumber: userDetails.phoneNumber,
                user_email: userDetails.email,
                isVerified: userDetails.isVerified
            }
            return res.json({ msg: "user signed in successfully", data: userdata });
        } else {
            const otp = Math.floor(1000 + Math.random() * 9000);
            sendVerificationCode(req.body.email, otp)
            const expire = Date.now() + 600 * 1000; // 10 minute from now
            await User.findOneAndUpdate({ email }, { $set: { otp: otp } }, { new: true })
            await User.findOneAndUpdate({ email }, { $set: { otpExpire: expire } }, { new: true })
            return res.status(201).json({ msg: "Otp sent to your email" })
        }
    } catch (error) {
        return res.status(500).json({ msg: "Something went wrong", data: { err: error } })
    }
}



// This funcxtion will register new emoployee or signup with new company 
const userSignup = async (req, res) => {
    try {
        const { firstName, lastName, companyname, phoneNumber, email, password } = req.body;
        if (!firstName || !lastName || !companyname || !phoneNumber || !email || !password) {
            return res.status(400).json({ msg: "All field are required.", })
        }
        const response = await User.findOne({ email: email })
        const newPass = CryptoJS.AES.encrypt(password, 'cico-general');
        req.body.password = newPass;
        const otp = Math.floor(1000 + Math.random() * 9000);
        const expire = Date.now() + 600 * 1000; // 10 minute from now
        req.body.otp = otp;
        req.body.otpExpire = expire;
        sendVerificationCode(req.body.email, otp)
        if (response) { return res.status(400).json({ msg: "user already exists.", }) }
        const user = new User(req.body);
        await user.save();
        res.status(201).json({ msg: "user registered succesfully" });
    } catch (err) {
        console.log(err);
        return res.status(500).json({ msg: "Internal Server Error..." })

    }

}


const sendVerificationCode = async (email, otp) => {
    const emailTemplateSource = fs.readFileSync(path.join(__dirname, "../views/verification.hbs"), "utf8")
    const otpTemplate = handlebars.compile(emailTemplateSource)
    const htmlToSend = otpTemplate({ otp })
    const mailOptions = {
        from: process.env.AUTH_EMAIL,
        to: email,
        subject: "CICO Application - OTP Verification",
        html: htmlToSend
    }


    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: process.env.AUTH_EMAIL,
            pass: process.env.AUTH_PASSWORD
        }
    });

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error("Error sending email:", error);
        } else {
            console.log("Email sent:", info.response);
        }
    });
}

const verifyOTP = async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ msg: "OTP is required.", });
        }
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ msg: "User not found.", });
        }
        if (user.otp !== otp) {
            return res.status(401).json({ message: "The OTP entered is invalid please verify its accuracy." });
        }
        if (user.otpExpire && new Date() > new Date(user.otpExpire)) {
            return res.status(401).json({ msg: "OTP has expired." });
        }
        user.isVerified = true;
        await user.save();
        await User.findOneAndUpdate({ email }, { $unset: { otp: 1 } }, { new: true });
        await User.findOneAndUpdate({ email }, { $unset: { otpExpire: 1 } }, { new: true });
        return res.status(200).json({ msg: "Email verified successfully." });
    } catch (error) {
        console.error("Error verifying OTP:", error);
        return res.status(500).json({ msg: "Internal Server Error." });
    }
}

const resendOtp = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ message: "Email is required." });
        }
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: "User not found." });
        }
        // Generate a new OTP
        const otp = Math.floor(1000 + Math.random() * 9000);
        const expire = Date.now() + 600 * 1000; // 10 minute from now 
        // Send the new OTP to the user's email
        sendVerificationCode(email, otp);
        await User.findOneAndUpdate({ email }, { $set: { otp: otp }, }, { new: true })
        await User.findOneAndUpdate({ email }, { $set: { otpExpire: expire } }, { new: true })
        // Update the user record in the database with the new OTP
        return res.status(200).json({ message: "OTP resent successfully." });
    } catch (error) {
        console.error("Error resending OTP:", error);
        return res.status(500).json({ message: "Internal Server Error." });
    }
}

// This function will create new employee company wise 
const createEmployee = async (req, res) => {
    const companyId = req.user.id
    try {
        const { firstName, lastName, phoneNumber, email, password } = req.body;
        if (!firstName || !lastName || !phoneNumber || !email || !password) {
            return res.status(400).json({ msg: "All field are required." })
        }
        const company = await User.find({ _id: companyId }) // Getting company details
        console.log(company);
        if (!company) {
            return res.status(400).json({ msg: "Company not found." })
        }
        const emp = await User.findOne({ email });
        if (emp) {
            return res.status(400).json({ msg: "Email already exists." })
        }
        const newPass = CryptoJS.AES.encrypt(password, 'cico-general');
        // If the company exists and is valid, create the employee
        const employee = new User({
            firstName,
            lastName,
            phoneNumber,
            email,
            password: newPass,
            isCompany: false,
            isVerified: false,
            companyId: company._id // Assign the company's ObjectId to the employee's companyId field
        });
        await employee.save();
        res.status(201).json({ msg: "employee added succesfully" });

    } catch (error) {
        console.error("Error creating employee:", error);
        res.status(500).json({ msg: "Internal server error" });
    }
}

// get all user from database
const getEmployeesCompanyWise = async (req, res) => {
    const companyId = req.user.id
    try {
        // Retrieve all employees for the found company
        const employees = await User.find({ companyId: companyId });
        if (!employees || employees.length === 0) {
            return res.status(404).json({ msg: "No employees found for this company." });
        }
        let employePayload = [];
        // Payload created for the somefeild are send to client side 
        for (let i = 0; i < employees.length; i++) {
            const employee = employees[i];
            console.log(employee);
            const employeePayload = {
                firstName: employee.firstName,
                lastName: employee.lastName,
                phoneNumber: employee.phoneNumber,
                email: employee.email,
                _id: employee._id
            };
            employePayload.push(employeePayload);
        }
        console.log(employePayload);

        // If employees are found, return them
        res.status(200).json({ msg: "Employees found for the company.", data: { employees: employePayload } });
    } catch (error) {
        console.error("Error fetching employees:", error);
        res.status(500).json({ msg: "Internal server error" });
    }
}



// this function will Update the employee details using id 
const updateEmployee = async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ msg: "employee id is required.", });
    const employee = await User.findOne({ email: req.body.email })
    if (employee) return res.status(400).json({ msg: "Email already exists.", });
    const updatedEmployee = await User.findByIdAndUpdate(id, req.body, { new: true })
    res.status(200).json({ updatedEmployee })
}


// This function will delete the employee using there is 
const deleteEmployee = async (req, res) => {
    const { id } = req.params;
    console.log(id);
    if (!id) return res.status(400).json({ msg: "employee id is required.", });
    const employee = await User.findOneAndDelete({ _id: id }).exec();
    if (!employee) { return res.status(400).json({ msg: "employee not found.", }); }
    res.status(200).json({ msg: "employee deleted successfully" });
}

const forgotPassword = async (req, res) => {
    try{
        const {email} = req.body;
        if (!email) {
            return res.status(204).json({ msg: "email is required" })
        }
        const userDetails = await User.findOne({ email: email })
        console.log("userDetails:", userDetails)
        if (!userDetails) {
            return res.status(404).json({ msg: "User not found" })
        }
    }
    catch(error){
        return res.status(500).json({ msg: "Something went wrong", data: { err: error } })
    }
}

module.exports = { userLogin, verifyOTP, userSignup, createEmployee, getEmployeesCompanyWise, updateEmployee, deleteEmployee, resendOtp, forgotPassword }