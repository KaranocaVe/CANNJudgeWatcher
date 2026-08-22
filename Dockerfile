FROM maven:3.9.9-eclipse-temurin-21 AS backend-build
WORKDIR /workspace
COPY pom.xml .
COPY src ./src
RUN mvn -q -DskipTests package

FROM node:22-alpine AS frontend-build
WORKDIR /workspace/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --prefer-offline --fetch-retries=5 --fetch-timeout=120000
COPY frontend ./
RUN npm run build

FROM eclipse-temurin:21-jre AS backend
WORKDIR /app
COPY --from=backend-build /workspace/target/cannjudge-watcher-0.1.0.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java","-jar","/app/app.jar"]

FROM nginx:1.27-alpine AS frontend
COPY --from=frontend-build /workspace/frontend/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
