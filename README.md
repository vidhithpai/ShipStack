# DeployMate

Mini Platform-as-a-Service (PaaS) that runs locally and on AWS EC2. Deploy GitHub repos as Docker containers with one click.

## Features

- **Auth**: Register / Login with JWT
- **Deploy**: Paste a GitHub repo URL → clone, detect stack (Node/Python/Java Maven), generate Dockerfile, build image, run container with 512m memory and 0.5 CPU
- **Manage**: View status, logs, restart, stop, delete (container + image + folder + DB)

## Tech Stack

- **Backend**: Node.js, Express, MongoDB (Mongoose), JWT, Docker CLI (child_process)
- **Frontend**: React (Vite), React Router, Axios
- **Deployments**: Stored under `deployments/{deploymentId}`, Docker images `deploymate-{id}`

## Prerequisites

- Node.js 18+
- MongoDB running locally or `MONGODB_URI` set
- Docker installed and running (for builds and runs)
- Git (for cloning repos)

## Quick Start

### 1. Backend

```bash
cd backend
cp .env.example .env
# Edit .env: set JWT_SECRET, MONGODB_URI if needed
npm install
npm start
```

Backend runs at `http://localhost:3000`. Deployments folder is `backend/deployments` (created automatically).

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend runs at `http://localhost:5173` and proxies `/api` to the backend.

### 3. Use the app

1. Open http://localhost:5173
2. Register or log in
3. New Deployment → enter a public GitHub repo URL (e.g. `https://github.com/owner/repo`)
4. Wait for build; open the deployment to see logs and the app URL (e.g. http://localhost:3001)

## Environment (backend)

| Variable        | Default                      | Description                |
|----------------|------------------------------|----------------------------|
| PORT           | 3000                         | Backend port               |
| MONGODB_URI    | mongodb://localhost:27017/deploymate | MongoDB connection  |
| JWT_SECRET     | (change in production)       | Secret for JWT signing     |
| JWT_EXPIRES    | 7d                           | Token expiry               |
| BASE_PORT      | 3001                         | First port for containers  |
| INTERNAL_PORT  | 3000                         | Port inside container      |

## Project structure

```
deploymate/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── routes/
│   │   ├── models/
│   │   ├── middleware/
│   │   ├── utils/
│   │   └── app.js
│   ├── Dockerfile
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   └── services/
│   ├── Dockerfile
│   └── package.json
├── templates/          # Dockerfile templates (node, python, java-maven)
└── nginx/              # Optional reverse proxy config for EC2
```

## Security notes

- Only **github.com** HTTPS URLs are accepted; URLs are validated and sanitized.
- Docker is invoked with explicit arguments (no user input in shell).
- Deployment paths are constrained under `deployments/` with safe IDs.
- Set a strong `JWT_SECRET` and use HTTPS in production.

## License

MIT
