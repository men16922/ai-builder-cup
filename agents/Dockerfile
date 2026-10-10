# One image serves every agent; the AGENT environment variable selects the role.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY pyproject.toml ./
COPY src ./src
RUN pip install .
RUN useradd --create-home --uid 10001 agent
USER agent
EXPOSE 8080
CMD ["python", "-m", "mobileops_agents.serve"]
