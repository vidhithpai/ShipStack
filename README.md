# DeployMate

DeployMate is a container-based mini Platform-as-a-Service (PaaS) that lets users deploy public GitHub repositories automatically using Docker.

It is built for fast, self-serve deployments with a clean backend orchestration layer and a lightweight React dashboard for managing live containers.

## Features

- 🚀 Deploy public GitHub repositories in a few clicks
- 🗂️ Root directory selection support for monorepo-style projects
- 🧠 Automatic stack detection for Node.js, Python, and Java (Maven)
- 🐳 Auto Dockerfile generation when no Dockerfile is provided
- 📦 Support for user-provided `Dockerfile`
- 🧩 Support for user-provided `docker-compose.yml` / `docker-compose.yaml`
- 🏗️ Automatic docker-compose generation for frontend + backend monorepos
- 🔄 Full container lifecycle management: start, stop, restart, delete
- 📊 Deployment status tracking: `PENDING`, `BUILDING`, `RUNNING`, `FAILED`, `STOPPED`
- 📜 Deployment and runtime logs streaming
- ⚙️ Resource limits (CPU and memory) for container execution
- 🔒 Secure Docker execution with restricted flags and validation rules

## Deployment Logic

DeployMate resolves deployment strategy in the following order:

1. **If `docker-compose.yml` / `docker-compose.yaml` exists**  
   Use the existing compose setup directly.

2. **Else if root `Dockerfile` exists**  
   Use the provided Dockerfile to build and run.

3. **Else if frontend + backend folders are detected**  
   Auto-generate service Dockerfiles (when missing), generate root `docker-compose.yml`, then deploy with Compose.

4. **Else fallback to stack detection**  
   Detect Node/Python/Java stack, generate Dockerfile from templates, then deploy.

## Tech Stack

- **Backend:** Node.js + Express
- **Frontend:** React (Vite)
- **Database:** MongoDB
- **Containerization:** Docker
- **Orchestration:** Docker Compose
- **Deployment Target:** AWS EC2 (planned)

## Architecture

```text
User submits GitHub repository
        ↓
Backend clones repository
        ↓
Deployment type detection (compose / Dockerfile / auto-compose / generated)
        ↓
Build Docker image(s)
        ↓
Run container(s)
        ↓
Expose via assigned host port(s)
```

## Security

- Resource limits are enforced for single-container deployments (`--memory`, `--cpus`, `--pids-limit`)
- Privileged container mode is blocked
- Host network access is blocked
- Unsafe compose directives are rejected before execution
- GitHub URLs are validated and sanitized before clone
- Docker commands are executed safely using controlled argument lists and spawn-based execution

## Local Setup

1. Clone the repository
   ```bash
   git clone <your-repo-url>
   cd ShipStack
   ```
2. Install backend dependencies
   ```bash
   cd backend
   npm install
   ```
3. Start backend
   ```bash
   npm run dev
   ```
4. Start frontend
   ```bash
   cd ../frontend
   npm install
   npm run dev
   ```
5. Ensure Docker Engine/Desktop is running before creating deployments

## Status and Lifecycle

Each deployment is tracked with runtime metadata and container identifiers:

- Status transitions: `PENDING` -> `BUILDING` -> `RUNNING` (or `FAILED`)
- Supported lifecycle actions:
  - **Start**
  - **Stop**
  - **Restart**
  - **Delete**
- Compose deployments support multi-service logs and coordinated stop/down operations

## Future Improvements

- 🔔 GitHub webhook-based auto redeploy
- 🌐 Nginx reverse-proxy route management
- ☸️ Multi-node deployments with Kubernetes
- 🛠️ CI/CD integration for automated pipelines
- 🌍 Subdomain-based per-deployment routing

## Project Structure

```text
ShipStack/
├── backend/
│   ├── src/
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── routes/
│   │   ├── models/
│   │   ├── middleware/
│   │   └── utils/
│   └── package.json
├── frontend/
│   ├── src/
│   └── package.json
└── templates/
    ├── node.template
    ├── python.template
    └── java-maven.template
```

## License

MIT
