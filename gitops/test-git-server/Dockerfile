# A tiny Git server over HTTP (git-http-backend behind nginx) to test ArgoCD without GitHub.
# NOT for real use: no authentication.
FROM alpine:3.20
RUN apk add --no-cache git git-daemon nginx fcgiwrap spawn-fcgi
COPY nginx.conf /etc/nginx/nginx.conf
COPY start.sh /start.sh
RUN chmod +x /start.sh
EXPOSE 8080
CMD ["/start.sh"]
