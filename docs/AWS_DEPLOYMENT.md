# AWS Docker Deployment

This project builds into one Docker image. The image compiles the Vite frontend, copies it into the Express backend, and serves the whole app on port `3001`.

## Required Runtime Environment Variables

Set these in your AWS service, not in the image:

```txt
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.1-flash-lite
JSON_BODY_LIMIT=25mb
PORT=3001
```

The frontend uses same-origin API calls in production, so you do not need `VITE_GEMINI_API_URL` when the Express server serves the built frontend.

## Build Locally

```bash
docker build -t chatstream:local .
docker run --env-file server/.env -p 3001:3001 chatstream:local
```

Open:

```txt
http://localhost:3001
```

Health check:

```txt
http://localhost:3001/health
```

## Push To Amazon ECR

From this project root, with AWS CLI and Docker logged in/configured:

```powershell
.\deploy\aws-ecr-push.ps1 -AwsAccountId 123456789012 -Region us-east-1 -RepositoryName chatstream -ImageTag latest
```

The script creates the ECR repository if needed, builds the Docker image, tags it, and pushes it.

Equivalent Bash commands:

```bash
AWS_ACCOUNT_ID=123456789012
AWS_REGION=us-east-1
REPOSITORY_NAME=chatstream
IMAGE_TAG=latest
IMAGE_URI="$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/$REPOSITORY_NAME:$IMAGE_TAG"

aws ecr describe-repositories --repository-names "$REPOSITORY_NAME" --region "$AWS_REGION" \
  || aws ecr create-repository --repository-name "$REPOSITORY_NAME" --region "$AWS_REGION"

aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

docker build -t "$REPOSITORY_NAME:$IMAGE_TAG" .
docker tag "$REPOSITORY_NAME:$IMAGE_TAG" "$IMAGE_URI"
docker push "$IMAGE_URI"
```

## Deploy Option A: AWS App Runner

App Runner is the simplest container deployment path for this app.

1. Open AWS App Runner.
2. Create service.
3. Choose Container registry, then Amazon ECR.
4. Select the pushed `chatstream` image.
5. Set port to `3001`.
6. Add the runtime environment variables listed above.
7. Set health check path to `/health`.
8. Create and deploy.

## Deploy Option B: ECS Fargate

Use this if you already run services behind an Application Load Balancer.

1. Push the image to ECR.
2. Create an ECS cluster with Fargate.
3. Create a task definition with container port `3001`.
4. Add the runtime environment variables listed above.
5. Store `GEMINI_API_KEY` in AWS Secrets Manager or SSM Parameter Store and inject it as a container secret.
6. Create an ECS service behind an Application Load Balancer.
7. Configure the target group health check path as `/health`.

## Notes

- Do not bake `GEMINI_API_KEY` into the Docker image.
- For public HTTPS, use App Runner's default domain or attach a custom domain. With ECS, terminate HTTPS at the Application Load Balancer.
- If you deploy frontend and backend separately later, set `VITE_GEMINI_API_URL` at image build time to the backend URL and rebuild the image.
