from pywebpush import webpush, WebPushException
import json

def send_web_push_notification(subscription_info, data, vapid_private_key, vapid_claims):
    """
    Send web push notification to a subscription
    """
    try:
        webpush(
            subscription_info=subscription_info,
            data=data,
            vapid_private_key=vapid_private_key,
            vapid_claims=vapid_claims,
            timeout=10
        )
        return True
    except WebPushException as ex:
        print(f"WebPushException: {ex}")
        if ex.response and ex.response.status_code == 410:
            # Subscription is no longer valid
            print("Subscription expired")
        return False
    except Exception as ex:
        print(f"Exception: {ex}")
        return False
