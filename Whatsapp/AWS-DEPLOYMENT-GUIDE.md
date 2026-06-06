# AWS Deployment Guide

Complete guide to deploy TalentWale on AWS with your $100 free tier credit.

## 📊 Cost Estimation (12 months with $100 credit)

```
Frontend (Amplify):     $0      ✅ FREE
Backend (Lambda):       $0-2    ✅ Almost FREE (pay per execution)
Database (RDS):         $0      ✅ FREE tier 12 months
Total:                  $0-2/month

$100 credit = 50+ months! 🎉
```

---

## Option 1: Lambda + API Gateway (Recommended for Low Usage) ⭐

### Benefits
- ✅ Pay only when used
- ✅ Auto-scaling
- ✅ Zero maintenance
- ✅ No servers to manage

### Step 1: Prepare Backend

```bash
cd backend
npm install --production
zip -r ../backend.zip .
```

### Step 2: Create Lambda Function

```bash
# Go to AWS Lambda Console
# 1. Create new function: Node.js 18.x runtime
# 2. Upload backend.zip
# 3. Set handler: server.handler (or index.handler)
# 4. Set timeout: 60 seconds
# 5. Set memory: 256 MB
# 6. Add environment variables from .env
```

### Step 3: Create API Gateway

```bash
# 1. Create new API (REST API)
# 2. Create resource: /api
# 3. Create methods: POST, GET
# 4. Integration type: Lambda Function
# 5. Select your Lambda function
# 6. Enable CORS
# 7. Deploy to stage: prod
```

### Step 4: RDS PostgreSQL

```bash
# 1. Go to RDS Console
# 2. Create database: PostgreSQL 15
# 3. DB instance class: db.t3.micro (free tier)
# 4. Storage: 20GB (free tier)
# 5. Backup retention: 7 days
# 6. Multi-AZ: No
# 7. Get endpoint URL and update DATABASE_URL
```

---

## Option 2: EC2 + Auto-Scaling (Alternative)

### Benefits
- Full control
- Always running
- Good for high traffic

### Step 1: Launch EC2 Instance

```bash
# 1. Go to EC2 Dashboard
# 2. Launch instance:
#    - AMI: Ubuntu 22.04 LTS
#    - Instance type: t2.micro (free tier)
#    - Security group: Allow SSH (22), HTTP (80), HTTPS (443)
#    - Storage: 30GB (free tier)
# 3. Create key pair and download .pem file
```

### Step 2: SSH and Setup

```bash
ssh -i your-key.pem ubuntu@your-instance-ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PM2
sudo npm install -g pm2

# Clone repository
git clone <your-repo-url>
cd Whatsapp/backend
npm install --production
```

### Step 3: Start Server with PM2

```bash
pm2 start server.js --name "talentwale-backend"
pm2 startup
pm2 save

# Check status
pm2 status
pm2 logs
```

### Step 4: Setup Nginx Reverse Proxy

```bash
sudo apt install -y nginx

# Create Nginx config
sudo nano /etc/nginx/sites-available/default
```

Add:
```nginx
server {
    listen 80 default_server;
    server_name _;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo systemctl restart nginx
```

### Step 5: Setup RDS Database

(Same as Lambda option - see Step 4 above)

---

## Option 3: Amplify + Lambda (Best of Both Worlds)

### Frontend with Amplify

```bash
# 1. Go to AWS Amplify Console
# 2. Connect GitHub repo
# 3. Select frontend folder
# 4. Create new build spec (buildspec-frontend.yml)
# 5. Deploy
```

### Backend with Lambda

(Same as Option 1 - Lambda setup)

---

## Frontend Deployment

### Using Amplify (Easiest)

```bash
# Install CLI
npm install -g @aws-amplify/cli

# Login to AWS
amplify configure

# Initialize
amplify init

# Add hosting
amplify add hosting

# Publish
amplify publish
```

### Using S3 + CloudFront

```bash
# 1. Create S3 bucket
aws s3 mb s3://talentwale-frontend-prod

# 2. Upload files
aws s3 sync frontend/src s3://talentwale-frontend-prod --delete

# 3. Create CloudFront distribution
# 4. Set S3 bucket as origin
# 5. Enable HTTPS
# 6. Set custom domain (optional)
```

---

## Environment Setup

### Create .env file for Backend

```bash
# .env
AZURE_COMMUNICATION_CONNECTION_STRING=your_value
DATABASE_URL=postgresql://user:pass@rds-endpoint:5432/talentwale
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
PORT=3000
NODE_ENV=production
```

### Frontend Configuration

```bash
# .env
REACT_APP_API_URL=https://your-api-gateway-url.execute-api.us-east-1.amazonaws.com/prod
REACT_APP_API_TIMEOUT=30000
```

---

## Domain & HTTPS Setup

### Custom Domain with Route 53

```bash
# 1. Purchase domain in Route 53 (or import existing)
# 2. Create hosted zone
# 3. Point CloudFront/Amplify to domain
# 4. Get ACM certificate (free)
# 5. Enable HTTPS
```

---

## Monitoring & Logging

### CloudWatch Logs

```bash
# Lambda logs
aws logs tail /aws/lambda/talentwale-backend --follow

# EC2 logs
ssh ubuntu@instance-ip
tail -f /var/log/pm2.log
```

### Alarms

```bash
# Set up CloudWatch alarms for:
# - Lambda errors
# - Lambda duration
# - RDS CPU
# - RDS storage
```

---

## Cost Optimization

```
Strategies to stay within $100 credit:

1. Use Lambda instead of EC2 for low traffic
2. Use RDS free tier (12 months)
3. Use Amplify for static hosting (free)
4. Set S3 lifecycle policies
5. Monitor CloudWatch alarms
6. Use reserved capacity (if high usage)
7. Enable auto-scaling
```

---

## Deployment Checklist

### Backend
- [ ] Create Lambda function
- [ ] Configure API Gateway
- [ ] Create RDS database
- [ ] Set environment variables
- [ ] Test API endpoints
- [ ] Enable CloudWatch logs
- [ ] Set up alarms

### Frontend
- [ ] Deploy to Amplify or S3
- [ ] Configure CloudFront CDN
- [ ] Update API endpoint in .env
- [ ] Test all pages
- [ ] Test responsive design
- [ ] Enable HTTPS
- [ ] Setup domain (optional)

---

## Troubleshooting

### Lambda Cold Starts
```
Problem: Slow initial requests
Solution: 
- Increase memory (improves CPU)
- Use provisioned concurrency
- Minimize dependencies
```

### Database Connection Issues
```
Problem: "Database connection failed"
Solution:
- Check security group allows Lambda IP
- Verify DATABASE_URL
- Check RDS is in same VPC
- Enable Lambda VPC access
```

### CORS Errors
```
Problem: Frontend cannot call API
Solution:
- Enable CORS in API Gateway
- Add Origin header
- Configure allowed methods
```

---

## Reference Links

- AWS Pricing: https://aws.amazon.com/pricing/
- Lambda Pricing: https://aws.amazon.com/lambda/pricing/
- RDS Free Tier: https://aws.amazon.com/rds/free/
- Amplify Hosting: https://aws.amazon.com/amplify/

---

## Next Steps

1. ✅ Separate frontend and backend (DONE)
2. ⏭️ Setup AWS account
3. ⏭️ Deploy backend (Lambda or EC2)
4. ⏭️ Deploy frontend (Amplify or S3)
5. ⏭️ Setup custom domain
6. ⏭️ Configure monitoring
7. ⏭️ Optimize costs
