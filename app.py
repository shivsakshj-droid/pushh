from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
from utils.webpush import send_web_push_notification

app = Flask(__name__)
CORS(app, origins=[
    "https://yourdomain.com",  # Replace with your Hostinger domain
    "http://localhost:3000",
    "http://127.0.0.1:3000"
])

# In production, use environment variables
VAPID_PRIVATE_KEY = os.environ.get('VAPID_PRIVATE_KEY', 'your_vapid_private_key')
VAPID_PUBLIC_KEY = os.environ.get('VAPID_PUBLIC_KEY', 'your_vapid_public_key')
VAPID_CLAIMS = {
    "sub": "mailto:your-email@domain.com"  # Replace with your email
}

# Store subscriptions in memory (use database in production)
subscriptions = []

@app.route('/')
def home():
    return jsonify({"message": "Web Push Notification Backend"})

@app.route('/api/subscribe', methods=['POST'])
def subscribe():
    try:
        subscription_data = request.json
        
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

@app.route('/api/unsubscribe', methods=['POST'])
def unsubscribe():
    try:
        subscription_data = request.json
        global subscriptions
        subscriptions = [sub for sub in subscriptions if sub['endpoint'] != subscription_data['endpoint']]
        
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route('/api/send-notification', methods=['POST'])
def send_notification():
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
            "failed": failed_count
        })
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route('/api/vapid-public-key', methods=['GET'])
def get_vapid_public_key():
    return jsonify({"publicKey": VAPID_PUBLIC_KEY})

@app.route('/api/subscriptions', methods=['GET'])
def get_subscriptions():
    return jsonify({"count": len(subscriptions), "subscriptions": subscriptions})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
