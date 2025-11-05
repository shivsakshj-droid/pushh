// push-notification.js
class PushNotificationManager {
    constructor() {
        this.backendUrl = 'https://your-render-app.onrender.com'; // Replace with your Render URL
        this.isSubscribed = false;
        this.swRegistration = null;
        this.publicKey = null;
        
        this.init();
    }
    
    async init() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            console.log('Push notifications are not supported');
            return;
        }
        
        try {
            // Get VAPID public key from backend
            this.publicKey = await this.getVapidPublicKey();
            
            // Register service worker
            this.swRegistration = await navigator.serviceWorker.register('/service-worker.js');
            console.log('Service Worker registered');
            
            // Check current subscription status
            await this.checkSubscription();
        } catch (error) {
            console.error('Error initializing push notifications:', error);
        }
    }
    
    async getVapidPublicKey() {
        const response = await fetch(`${this.backendUrl}/api/vapid-public-key`);
        const data = await response.json();
        return data.publicKey;
    }
    
    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - base64String.length % 4) % 4);
        const base64 = (base64String + padding)
            .replace(/\-/g, '+')
            .replace(/_/g, '/');
        
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }
    
    async checkSubscription() {
        const subscription = await this.swRegistration.pushManager.getSubscription();
        this.isSubscribed = !(subscription === null);
        
        this.updateUI();
        
        if (this.isSubscribed) {
            console.log('User is subscribed');
        } else {
            console.log('User is NOT subscribed');
        }
    }
    
    async subscribe() {
        try {
            const applicationServerKey = this.urlBase64ToUint8Array(this.publicKey);
            const subscription = await this.swRegistration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: applicationServerKey
            });
            
            // Send subscription to backend
            await this.sendSubscriptionToBackend(subscription);
            
            this.isSubscribed = true;
            this.updateUI();
            console.log('User subscribed successfully');
            
        } catch (error) {
            if (Notification.permission === 'denied') {
                console.warn('Permission for notifications was denied');
            } else {
                console.error('Failed to subscribe:', error);
            }
        }
    }
    
    async unsubscribe() {
        try {
            const subscription = await this.swRegistration.pushManager.getSubscription();
            
            if (subscription) {
                await subscription.unsubscribe();
                await this.removeSubscriptionFromBackend(subscription);
                
                this.isSubscribed = false;
                this.updateUI();
                console.log('User unsubscribed successfully');
            }
        } catch (error) {
            console.error('Error unsubscribing:', error);
        }
    }
    
    async sendSubscriptionToBackend(subscription) {
        try {
            await fetch(`${this.backendUrl}/api/subscribe`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(subscription)
            });
        } catch (error) {
            console.error('Error sending subscription to backend:', error);
        }
    }
    
    async removeSubscriptionFromBackend(subscription) {
        try {
            await fetch(`${this.backendUrl}/api/unsubscribe`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(subscription)
            });
        } catch (error) {
            console.error('Error removing subscription from backend:', error);
        }
    }
    
    updateUI() {
        const subscribeBtn = document.getElementById('subscribeBtn');
        const unsubscribeBtn = document.getElementById('unsubscribeBtn');
        const statusElement = document.getElementById('notificationStatus');
        
        if (subscribeBtn && unsubscribeBtn && statusElement) {
            if (this.isSubscribed) {
                subscribeBtn.style.display = 'none';
                unsubscribeBtn.style.display = 'block';
                statusElement.textContent = 'Notifications: Enabled';
                statusElement.className = 'status-enabled';
            } else {
                subscribeBtn.style.display = 'block';
                unsubscribeBtn.style.display = 'none';
                statusElement.textContent = 'Notifications: Disabled';
                statusElement.className = 'status-disabled';
            }
        }
    }
    
    async requestPermission() {
        if (Notification.permission === 'default') {
            const permission = await Notification.requestPermission();
            return permission === 'granted';
        }
        return Notification.permission === 'granted';
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    window.pushManager = new PushNotificationManager();
});