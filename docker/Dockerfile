FROM node:20

WORKDIR /workspace

COPY docker/entrypoint.sh /usr/local/bin/semantic-release-entrypoint
RUN chmod +x /usr/local/bin/semantic-release-entrypoint

ENTRYPOINT ["semantic-release-entrypoint"]
CMD ["npx", "semantic-release", "--no-ci"]
