# Visa2Go — сервер заявок

Самостоятельный Cloudflare Worker + D1. Сервер и интерфейс рекомендуется размещать на одном адресе; административная сессия намеренно работает только в своём origin. Изолированный API для другого разрешённого origin возможен для публичных форм через `ALLOWED_ORIGINS`, но панель команды остаётся на адресе API.

## Что уже реализовано

- Сохранение заявки и задания на уведомление одной транзакцией D1; повторный `requestId` не дублирует обращение. Успех возвращается только после записи и повторного чтения.
- Проверка гражданства, направления, доступной категории, контакта, согласия, длины полей; honeypot и ограничение запросов.
- Закрытая панель API: заявки, статусы, каталог, агрегированная аналитика. Авторизация через секрет сервера и подписанную 8-часовую HttpOnly/SameSite=Strict cookie; секрет не хранится в браузере.
- Каталог сохраняется в D1 без изменения кода. Изменения доступны форме и карте через `/api/catalog`.
- Очередь уведомлений с блокировкой параллельной обработки и повторами каждые 5 минут. Поддерживается Telegram либо HTTPS webhook для почтовой/командной системы. Уведомления содержат номер заявки и маршрут, без контакта и комментария клиента. Сами контакты видны только авторизованной команде.
- Аналитика хранит только суточные счётчики трёх событий, направления и цели. Никаких имён, контактов, cookie-идентификаторов или сырых IP. Для лимитов используется короткоживущий HMAC IP. Счётчики удаляются через 90 дней; заявки автоматически не удаляются.

Без настроенного канала уведомлений **приём новых заявок выключен**, а метрика `notificationConfigured` равна `false`. Если канал отключён после сохранения заявки, существующая очередь остаётся `pending`. Наличие настроек не доказывает доставку: она подтверждается только успешным ответом провайдера. После 8 неудач доставка помечается `failed`; оператор должен исправить канал и повторно поставить такие строки в очередь через безопасный административный инструмент.

## Локальная проверка

Используется Node 24 и встроенный SQLite, без установки зависимостей:

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH node --test backend/worker.test.mjs
PATH=/opt/homebrew/opt/node@24/bin:$PATH node backend/dev.mjs
```

Локальная база находится в игнорируемом `backend/data/visa2go.sqlite`. Каталог при первом запуске копируется из `config/site.json`, если файл существует. Не включайте эту базу в архивы или Git. Форма по умолчанию не принимает обращения.

Для локальной проверки входа задайте `ADMIN_PASSWORD` (минимум 16 символов) и `SESSION_SECRET` (минимум 32 символа) через защищённое окружение. Не передавайте реальные секреты в чат, командную строку или репозиторий. Тесты используют отдельную базу в памяти и вымышленные данные.

## Публикация на бесплатном Workers

Текущая конфигурация — шаблон, **сервер пока не опубликован**. Нужна авторизация официального `wrangler login` в аккаунте владельца. Используйте только Free, без активации платных услуг. Если платформе нужны согласие, пароль или MFA, их вводит владелец.

1. Создать отдельную D1 `visa2go-leads` в авторизованном аккаунте. Скопировать `backend/wrangler.jsonc` в игнорируемый `backend/wrangler.local.jsonc` и вписать возвращённый `database_id`.
2. Применить схему: `wrangler d1 execute visa2go-leads --remote --file backend/schema.sql --config backend/wrangler.local.jsonc`. Проверить реальную D1 и привязку `DB` перед следующими шагами.
3. Через `wrangler secret put NAME --config backend/wrangler.local.jsonc` или официальную панель настроить `ADMIN_PASSWORD`, `SESSION_SECRET`, а также Telegram (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) **или** `NOTIFICATION_WEBHOOK_URL` и при необходимости `NOTIFICATION_WEBHOOK_SECRET`. Эти значения должны относиться именно к Visa2Go.
4. Указать `PUBLIC_ORIGIN`, актуальный `SOURCE_SHA`, оставив `LEAD_COLLECTION_ENABLED=false` и `LEGAL_DOCUMENTS_APPROVED=false`. Собрать публичные файлы: `node backend/build.mjs`; затем `wrangler deploy --config backend/wrangler.local.jsonc`.
5. Через панель команды сохранить проверенные сведения о компании, контакты, версии опубликованных юридических документов и только фактически доступные услуги. Установить `reviewed=true` после проверки владельцем. Само значение `reviewed` не является юридическим заключением и **не включает** приём заявок.
6. Текущие `privacy.html` и `terms.html` — страницы дизайн-превью. Их необходимо заменить на документы именно оператора Visa2Go с актуальными реквизитами, контактами, обработкой заявок, поставщиками хранения/уведомлений и согласованными условиями. Только после фактической публикации этих документов, проверки сведений владельцем и настройки рабочего уведомления установить `LEGAL_DOCUMENTS_APPROVED=true` и `LEAD_COLLECTION_ENABLED=true`, затем опубликовать. Пройти путь с синтетической заявкой и проверить D1, закрытую панель и реальную доставку уведомления. Только после этого считать приём обращений запущенным.

Функция `/api/health` возвращает SHA публикации. Перед релизом сверять этот SHA и проверять публичный интерфейс. Полные данные клиентов, база и серверные секреты никогда не должны попадать на GitHub Pages. Текущий GitHub Pages предназначен для дизайн-превью: [официальные ограничения](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

## API

- `GET /api/catalog` → `{catalog, collectionEnabled}`. Пустой каталог и `false`, если D1 ещё не настроена.
- `POST /api/leads` JSON: `requestId` (UUID), `name`, `contact`, `channel` (`telegram|whatsapp|email`), `citizenship`, `citizenshipOther` (для `other`), `destination` (также `undecided`), `purpose` (`study|work|tourism|other`), `residence?`, `comment?`, `consent:true`, `website:''`. Ответ 201 `{ok:true,id,createdAt,duplicate:false}`; повтор — 200 с `duplicate:true`. Ошибки — `{ok:false,error}` и HTTP 400/401/403/409/413/415/429/503.
- `POST /api/events` → `{type:'page_view'|'form_start'|'form_submit',destination?,purpose?}`. Другие поля запрещены. Событие `form_submit` — клиентский счётчик; число реально принятых заявок рассчитывается отдельно по таблице `leads`.
- `POST /api/admin/session` `{password}` → защищённая cookie. `GET` проверяет вход, `DELETE` очищает cookie.
- `GET /api/admin/leads?status=&cursor=&limit=30` → `{leads,nextCursor}`. `leads` используют `createdAt`, `updatedAt`, `citizenshipOther`.
- `PATCH /api/admin/leads/:id` `{status:'new'|'contacted'|'closed'}`.
- `DELETE /api/admin/leads/:id` удаляет конкретную заявку и её очередь уведомления после авторизации. Это действие необратимо; применять только к выбранному обращению по запросу уполномоченного оператора. Клиентская аналитика остаётся агрегированной без связи с заявкой.
- `GET|PUT /api/admin/catalog` → `{catalog,collectionEnabled}`; PUT принимает `{catalog}`.
- `GET /api/admin/metrics` → `{leads:[{status,count}],notifications:[{status,count}],events:[{day,type,count}],notificationConfigured}`.

Каталог: `citizenships:[{id,name}]`, `destinations:[{id,name,services,city?,image?,alt?,popular?}]`, `company:{legalName,address,jurisdiction,registrationId?}`, `contacts:{telegram,whatsapp,email}`, `legal:{privacyVersion,termsVersion}`, `reviewed:boolean`. Идентификаторы стран — ISO alpha-2, кроме `other`; список гражданств задаёт популярные варианты, заявки принимают полный перечень ISO. Telegram принимает `@username` или `https://t.me/username` и сохраняет канонический HTTPS-адрес. WhatsApp допускает пробелы/скобки/дефисы, проверяет 7–15 цифр и сохраняет номер `+...`. Дополнительные поля сохраняются, но интерфейс обязан выводить текст безопасно, без HTML-интерполяции.
