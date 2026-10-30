FROM ghcr.io/project-osrm/osrm-backend@sha256:55dbfd47d984c2cacd64e32901b4321c86b5ec761438e69aa053dc78698a786f
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY infra/routing/start-osrm.sh /usr/local/bin/start-nexora-osrm
RUN chmod +x /usr/local/bin/start-nexora-osrm
ENV PORT=5000
EXPOSE 5000
ENTRYPOINT ["/usr/local/bin/start-nexora-osrm"]
