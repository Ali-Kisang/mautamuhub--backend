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
    resultCode: String,  // M-Pesa result code (0 = success)
    resultDesc: String,
    // Link to account type being paid for
    accountType: {
      type: String,
      enum: ['Regular', 'VIP', 'VVIP', 'Spa'],
    },
    duration: Number,
    // ✅ Add this for queuing profile payload (personal, location, etc.) until success
    queuedProfileData: {
      type: mongoose.Schema.Types.Mixed,  // Flexible for nested objects/arrays
    },
  },
  { timestamps: true }
);

export default mongoose.model('Transaction', transactionSchema);