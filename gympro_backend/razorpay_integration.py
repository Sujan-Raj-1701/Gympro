import razorpay
import os
from dotenv import load_dotenv

load_dotenv()

# Initialize Razorpay client
# Ensure these environment variables are set in your .env file
RAZORPAY_KEY_ID = os.getenv("RAZORPAY_KEY_ID")
RAZORPAY_KEY_SECRET = os.getenv("RAZORPAY_KEY_SECRET")

def get_razorpay_client():
    if not RAZORPAY_KEY_ID or not RAZORPAY_KEY_SECRET:
        raise Exception("Razorpay keys are not set in environment variables.")
    return razorpay.Client(auth=(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET))

def create_order(amount_in_rupees: float, currency: str = "INR", receipt: str = None):
    """
    Create a Razorpay order.
    Amount should be passed in Rupees. It will be converted to paise.
    """
    client = get_razorpay_client()
    data = {
        "amount": int(amount_in_rupees * 100),  # Convert to paise
        "currency": currency,
        "receipt": receipt,
        "payment_capture": 1 # Auto capture
    }
    order = client.order.create(data=data)
    return order

def verify_payment_signature(razorpay_order_id, razorpay_payment_id, razorpay_signature):
    """
    Verify the payment signature.
    """
    client = get_razorpay_client()
    try:
        client.utility.verify_payment_signature({
            'razorpay_order_id': razorpay_order_id,
            'razorpay_payment_id': razorpay_payment_id,
            'razorpay_signature': razorpay_signature
        })
        return True
    except razorpay.errors.SignatureVerificationError:
        return False
