# Web Push Notification Solution

A complete web push notification system with frontend on Hostinger and backend on Render.

## Architecture

- **Frontend**: Hostinger (static hosting)
- **Backend**: Render.com (Node.js + Express)
- **Database**: PostgreSQL (Render PostgreSQL add-on)
- **Push Service**: VAPID-based web push

## Prerequisites

- Hostinger account with SSL-enabled domain
- Render.com account
- VAPID keys for web push

## Setup Instructions

### 1. Generate VAPID Keys

```bash
# Install web-push globally
npm install -g web-push

# Generate VAPID keys
web-push generate-vapid-keys