from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
from utils.webpush import send_web_push_notification

app = Flask(__name__)

# Enhanced CORS configuration
CORS(app, origins=[
    "https://astrologer.playslap.shop",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "https://your-render-app.onrender.com"  # Add your Render URL if needed
])

# Add CORS headers for all responses
@app.after_request
def after_request(response):
    response.headers.add('Access-Control-Allow-Origin', 'https://astrologer.playslap.shop')
    response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
    response.headers.add('Access-Control-Allow-Credentials', 'true')
    return response

# Handle preflight requests
@app.before_request
def handle_preflight():
    if request.method == "OPTIONS":
        response = jsonify({"status": "success"})
        response.headers.add('Access-Control-Allow-Origin', 'https://astrologer.playslap.shop')
        response.headers.add('Access-Control-Allow-Headers', 'Content-Type,Authorization')
        response.headers.add('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS')
        return response

# Your VAPID keys - replace with actual keys
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', '')
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', '')
VAPID_CLAIMS = {
    "sub": "mailto:admin@astrologer.playslap.shop"
}

# Validate VAPID keys on startup
if not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
    print("⚠️ WARNING: VAPID keys are not set. Please set VAPID_PRIVATE_KEY and VAPID_PUBLIC_KEY environment variables.")
else:
    print("✅ VAPID keys loaded successfully")

subscriptions = []

@app.route('/')
def home():
    return jsonify({"message": "Web Push Notification Backend", "status": "active"})

@app.route('/api/subscribe', methods=['POST', 'OPTIONS'])
def subscribe():
    if request.method == 'OPTIONS':
        return jsonify({"status": "success"})
    
    try:
        subscription_data = request.json
        
        if not subscription_data:
            return jsonify({"status": "error", "message": "No subscription data provided"}), 400
        
        # Check if subscription already exists
        for sub in subscriptions:
            if sub['endpoint'] == subscription_data['endpoint']:
                return jsonify({"status": "already_subscribed"})
        
        subscriptions.append(subscription_data)
        print(f"New subscription added. Total: {len(subscriptions)}")
        
        return jsonify({"status": "success"})
    except Exception as e:
        print(f"Subscription error: {e}")
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route('/api/unsubscribe', methods=['POST', 'OPTIONS'])
def unsubscribe():
    if request.method == 'OPTIONS':
        return jsonify({"status": "success"})
    
    try:
        subscription_data = request.json
        global subscriptions
        subscriptions = [sub for sub in subscriptions if sub['endpoint'] != subscription_data['endpoint']]
        
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route('/api/send-notification', methods=['POST', 'OPTIONS'])
def send_notification():
    if request.method == 'OPTIONS':
        return jsonify({"status": "success"})
    
    try:
        notification_data = request.json
        title = notification_data.get('title', 'Notification')
        body = notification_data.get('body', 'You have a new message')
        icon = notification_data.get('icon', '/icon.png')
        url = notification_data.get('url', '/')
        
        payload = {
            "title": title,
            "body": body,
            "icon": icon,
            "url": url
        }
        
        success_count = 0
        failed_count = 0
        
        for subscription in subscriptions:
            try:
                send_web_push_notification(
                    subscription_info=subscription,
                    data=json.dumps(payload),
                    vapid_private_key=VAPID_PRIVATE_KEY,
                    vapid_claims=VAPID_CLAIMS
                )
                success_count += 1
            except Exception as e:
                print(f"Failed to send to {subscription['endpoint']}: {e}")
                failed_count += 1
        
        return jsonify({
            "status": "success",
            "sent": success_count,
            "failed": failed_count,
            "total_subscribers": len(subscriptions)
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route('/api/vapid-public-key', methods=['GET'])
def get_vapid_public_key():
    if not VAPID_PUBLIC_KEY:
        return jsonify({"error": "VAPID public key not configured"}), 500
    
    return jsonify({"publicKey": VAPID_PUBLIC_KEY})

@app.route('/api/subscriptions', methods=['GET'])
def get_subscriptions():
    return jsonify({"count": len(subscriptions), "subscriptions": subscriptions})

@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({
        "status": "healthy",
        "subscriptions": len(subscriptions),
        "vapid_configured": bool(VAPID_PUBLIC_KEY)
    })

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
