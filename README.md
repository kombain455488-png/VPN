# VPN Server Manager

Простая система управления Hysteria 2 подписками.

Архитектура: GitHub -> Render -> Neon PostgreSQL -> Hysteria 2 VPS -> Happ

## Переменные
DATABASE_URL, ADMIN_KEY, HY2_HOST, HY2_PORT, HY2_AUTH, SUBSCRIPTION_NAME

## Локальный запуск
npm install
Создайте .env на основе .env.example.
npm start
Откройте http://localhost:10000

## Render
Создайте Web Service из GitHub. Build: npm install, Start: npm start.

## Neon
Создайте PostgreSQL database и скопируйте DATABASE_URL.

## API
POST /api/users (header x-admin-key) JSON {"name":"Maks","days":30}
GET /api/users
GET /sub/TOKEN
Happ: happ://add/https://YOUR-RENDER-DOMAIN/sub/TOKEN

Hysteria 2 работает на отдельном Linux VPS.
Не помещайте пароли и ключи в GitHub.
