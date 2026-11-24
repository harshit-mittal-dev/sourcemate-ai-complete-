param(
  [Parameter(Mandatory = $true)]
  [string]$AwsAccountId,

  [string]$Region = "us-east-1",
  [string]$RepositoryName = "chatstream",
  [string]$ImageTag = "latest"
)

$ErrorActionPreference = "Stop"

$imageUri = "$AwsAccountId.dkr.ecr.$Region.amazonaws.com/${RepositoryName}:${ImageTag}"

aws ecr describe-repositories --repository-names $RepositoryName --region $Region *> $null
if ($LASTEXITCODE -ne 0) {
  aws ecr create-repository --repository-name $RepositoryName --region $Region | Out-Null
}

aws ecr get-login-password --region $Region |
  docker login --username AWS --password-stdin "$AwsAccountId.dkr.ecr.$Region.amazonaws.com"

docker build -t "${RepositoryName}:${ImageTag}" .
docker tag "${RepositoryName}:${ImageTag}" $imageUri
docker push $imageUri

Write-Host "Pushed image: $imageUri"
