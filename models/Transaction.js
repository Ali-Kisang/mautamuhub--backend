import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    profileUpdateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Profile',  
    },
    checkoutRequestID: { type: String, unique: true },  
    mpesaReceiptNumber: String,
    amount: { type: Number, required: true },
    phone: { type: String, required: true },
    accountReference: String,
    transactionDesc: String,
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
    },
    resultCode: String,  
    resultDesc: String,
    accountType: {
      type: String,
      enum: ['Regular', 'VIP', 'VVIP', 'Spa'],
    },
    duration: Number,
    queuedProfileData: {
      type: mongoose.Schema.Types.Mixed, 
    },
    processed: { type: Boolean, default: false },
    prorationStatus: { type: String },  
    prorationAmount: { type: Number, default: 0 },
    remainingDays: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('Transaction', transactionSchema);