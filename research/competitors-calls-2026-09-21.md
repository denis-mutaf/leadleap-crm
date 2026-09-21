# Экран «Звонки» и транскрипция разговора: референсы 6 продуктов

Дата исследования: 21.09.2026. Дата обращения ко всем источникам: 21.09.2026.
Метод: чтение публичной документации и help-центров через webfetch/websearch. Живые интерфейсы (демо-аккаунты) не открывались; дословные цитаты — из документации. Скриншоты не скачивались (нет доступа к продуктивным скриншотам без нарушения прав; папка `design/references/calls/` оставлена пустой сознательно — см. Пробелы).

---

## 1. amoCRM — раздел телефонии и карточка звонка в ленте

Источники:
- https://www.amocrm.ru/support/starting_work/phones (страница «Телефония», без даты)
- https://www.mango-office.ru/support/integratsiya-api/amocrm/kakyok (MANGO OFFICE, инструкция «Как позвонить или принять звонок»)
- https://www.amocrm.ru/vozmozhnosti-crm/crm-dlya-zvonkov (маркетинговая страница «CRM-система для холодных звонков»)

Ключевой факт архитектуры: у amoCRM **нет собственного единого экрана «Журнал звонков»**. Телефония — это 200+ виджетов провайдеров из amoMarket; звонки живут как события в карточке контакта/сделки, в «Неразобранном» и в аналитике на расширенных тарифах.

- Колонки списка звонков в порядке слева направо: **не применимо — такого списка в ядре amoCRM нет**. Дословно из документации: «amoCRM поддерживает интеграции с более чем 200 провайдерами телефонии», «Подключение выполняется через amoMarket». Список звонков с колонками есть только у провайдера (Mango, UIS, Zadarma) в его личном кабинете, а не в amoCRM.
- Фильтры над списком: в ядре — отсутствуют. У провайдеров свои (период, сотрудник, направление) — см. раздел 3.
- Результат звонка в строке: в ленте сделки звонок — это событие с иконкой трубки и текстом типа «Входящий звонок», длительностью; пропущенные — через область уведомлений и «Неразобранное». Дословно: «Логирование в „Неразобранное" — если звонок пропущен или не создана карточка, система фиксирует заявку». Цветовой кодировки результата в документации не зафиксировано.
- Прослушивание: **только в карточке**, плеера в строке нет (строки нет). Дословно: «Записи разговоров доступны в карточке клиента: можно прослушать запись; при необходимости скачать файл; хранение осуществляется на стороне провайдера телефонии». Волна (waveform), скорость, отметка «прослушано» — в документации отсутствуют (предположение: зависят от виджета провайдера).
- Клик по звонку: открывает карточку контакта/сделки, звонок — запись в истории взаимоотношений. Отдельной страницы звонка нет. Из инструкции MANGO: «Каждый звонок от контакта отображается в истории взаимоотношений с контактом. Если в Виртуальной АТС включена услуга записи разговоров, то здесь же можно прослушать или скачать запись разговора». Во время звонка — всплывающая «карточка звонка» с кнопкой «Добавить контакт».
- Транскрипция: **в ядре отсутствует**. В документации amoCRM слово «транскрипция/расшифровка» не встречается; расширенный функционал («автоматический обзвон», «WebRTC») — «предлагают некоторые провайдеры». Если нужна транскрипция — это продукт провайдера телефонии, а не amoCRM.
- Чего НЕТ: единого журнала звонков с колонками; фильтров по пропущенным/сотруднику в ядре; транскрипции; аналитики звонков на базовых тарифах («На расширенных тарифах доступна статистика по звонкам: количество входящих и исходящих звонков; длительность разговоров; эффективность работы менеджеров»).

Вывод для нас: amoCRM — анти-референс списка, но эталон карточки звонка-как-события в ленте: иконка + направление + длительность + плеер/скачивание внутри события.

## 2. Битрикс24 — «Телефония → Детализация звонков»

Источники:
- https://helpdesk.bitrix24.ru/open/18641558 «Детализация звонков: как получить данные о звонках», автор Ксения Морозова, обновлено 23.07.2026
- https://helpdesk.bitrix24.com/open/18710644 «Call Details» (EN), 08.11.2024
- https://helpdesk.bitrix24.ru/open/18600982 «Как записывать телефонные звонки», обновлено 24.07.2026

- Колонки (дословно, EN-вариант полнее; RU совпадает по смыслу): «Сотрудник (Employee)», «Номер Битрикс24 (Bitrix24 phone)», «Номер (Phone — номер клиента)», «Тип звонка (Call type)», «Время звонка / Длительность (Call duration)», «Дата вызова (Call date)», «Статус (Status)», «Стоимость (Cost)», «Стоимость расшифровки (Transcription cost)», «Оценка (Assessment)», «Запись (Recording)», «Журнал (Details — лог-файл)», «CRM (ссылка на лид/контакт/компанию)», «Комментарий (Comment)». Дословно: «By default, not all the available fields are displayed as columns in the list. You can configure the view by clicking the gear button». Порядок настраивается шестерёнкой; дефолтный порядок документацией не зафиксирован.
- Фильтры: строка поиска по одному или нескольким значениям («В строке поиска можно отфильтровать звонки по одному или нескольким значениям») + экспорт отфильтрованного в Excel. Отдельных чипсов «пропущенные/сотрудник/период» как в Ringostat нет — фильтр универсальный по полям.
- Результат звонка: поле «Статус — здесь указано, был звонок успешным или неуспешным. Неуспешный — это пропущенный звонок или звонок с ошибкой». Цвет/иконка в документации не описаны (предположение: в интерфейсе — текст статуса, без светофора как у коллтрекингов).
- Прослушивание: в колонке «Запись» — прослушать и скачать («Запись разговора с клиентом можно прослушать и скачать в разделе Телефония > Детализация звонков в колонке Запись»). Волна, скорость, «прослушано» — не документированы. Расшифровка: включается отдельно («Распознавание речи в телефонных звонках»), платная (колонка «Стоимость расшифровки»), «Когда расшифровка будет готова, в разделе Детализация звонков > Запись появится иконка трубки». Хранение записей — также в «Общий диск > Телефония — записи звонков», срок не ограничен.
- Клик по звонку: отдельной страницы звонка нет; детали — через колонки + «Журнал» (лог в новой вкладке, иконка книги) + карточка в CRM. Во время звонка — всплывающая «карточка звонка» (звонок из CRM в 1 клик, номеронабиратель, чат-уведомление о пропущенном с кнопкой перезвона).
- Транскрипция: только текст расшифровки у записи (иконка трубки), без анатомии «реплики/саммари/настроение» — этого уровня в документации Битрикс24 нет. Оценка — отдельно: клиент ставит 1–5 после звонка (колонка «Оценка»).
- Чего НЕТ: отдельной страницы/панели звонка; транскрипта с репликами и саммари; waveform и скорости; тегов/трекинга ключевых слов.

## 3. Ringostat (коллтрекинг) + UIS/CoMagic (проверочный второй источник)

Источники:
- https://help.ringostat.com/ru/articles/6413217-журнал-звонков-описание-статусов, автор Katerina Tverdochleb, 19.05.2024
- https://help.ringostat.com/ru/articles/6416694-карточка-звонка-журнала-звонков (без даты)
- https://help.ringostat.com/ru/articles/12975631-ai-анализ-качества-звонков
- https://www.uiscom.ru/academiya/spravochnyj-centr/otchety/spisok-obrashcheniy-zvonki, публикация 14.05.2020

- Путь: «Центр обращений — Журнал звонков». Возможности дословно: «создавать практически любые отчеты используя множество параметров и условий; экспортировать отчеты в .csv формат; производить быстрый поиск звонков по значению с помощью фильтра; получать информацию об общем количестве времени звонков».
- Статусы звонка (дословно, таблица): «Отвечен (ANSWERED) — не целевой звонок, на который ответил менеджер»; «Нет ответа (NO ANSWER) — пропущенный звонок»; «С ошибками (FAILED)»; «Занято (BUSY) — направления, на которые производилась переадресация, были заняты»; «Повторный (REPEATED)»; «Целевой (PROPER) — принятый звонок длительностью более заданной „Длины целевого звонка" с уникального номера в течение „Цикла продажи"»; «Не сработала схема переадресации (NO-FORWARD)». Маркетинговые статусы отделены от технических — эталон для наших «принят/пропущен/недозвон/занято».
- Фильтры: «Быстрый фильтр журнала звонков» + конструктор пользовательских отчётов по 30+ параметрам + готовые отчёты (у UIS дословно: фильтры «по входящим и исходящим; потерянным и принятым; длительности разговоров и ожидания ответа; виртуальным номерам; сотрудникам» + кнопка «Добавить фильтр», условия «и/или», сохранение выборки кнопкой-дискетой).
- Прослушивание: в карточке звонка блок «Разговор — аудиозапись звонка, функционал воспроизведения, изменения громкости, скорости, кнопки для копирования ссылки на звонок, загрузки и удаления аудиозаписи». Скорость есть; waveform документацией не подтверждена (предположение: есть прогресс-бар, не волна).
- Клик по звонку: **отдельная страница «Карточка звонка»** (клик по дате звонка). Блоки по порядку дословно: 1) «Общая информация о звонке — дата, время, продолжительность звонка, разговора и ожидания, кто звонил, куда звонили»; 2) «Разговор» (плеер); 3) «Транскрипция разговора — транскрипция, кнопка для копирования vtt-файла (тарифы Pro и Corporate)»; 4) «Сводная информация об AI-анализе — анализ качества звонка, настроение менеджера и клиента, содержание разговора»; 5) «Расширенная информация о звонке» (4 подраздела: маркетинг/источник, технические данные, сотрудник, история).
- Транскрипция: есть поблочно (текст + VTT-копия), плюс AI-надстройка: «Оценка каждого этапа разговора с соответствующим цветовым индикатором», «Настроение клиентов. Настроение представителей», этапы разговора по шаблону профиля. Клика «реплика = перемотка», поиска по тексту, тегов ключевых слов в карточке документация не описывает (предположение: поиск — через отчёты, а не внутри транскрипта).
- Чего НЕТ: саммари-блока «итог/следующие шаги» как у Gong; inline-комментариев к репликам; оценки-звёздочки клиентом (это у Битрикс24, не здесь).

## 4. HubSpot — Calls index + call detail с Conversation Intelligence

Источники:
- https://knowledge.hubspot.com/calling/review-call-recordings-and-transcripts, обновлено 31.08.2026
- API: https://developers.hubspot.com/docs/api-reference/latest/crm/extensions/calling-extensions/recordings-and-transcriptions

- Список: CRM > Calls («Call Index»). Дословно: «Calls in the Call Index are filterable by properties such as user, team, call outcome, and durations». Колонки — настраиваемые свойства объекта Calls (дословного порядка в документации нет; известные свойства API: hs_call_body, hs_call_duration, hs_call_from_number, hs_call_to_number, hs_call_status). Отдельного скриншота колонок документация не даёт.
- Фильтры: по user, team, call outcome, durations + глобальный поиск ключевых слов по записям («Use global search to find key terms in call recordings»).
- Результат звонка: свойство call outcome / hs_call_status (значения типа COMPLETED в API-примере). Цвет/иконка не документированы.
- Прослушивание: на странице звонка слева: кнопка Play + skip/rewind («click Play. You can also use the controls to skip or rewind»). Волна, скорость, «прослушано» — не документированы.
- Клик по звонку: **отдельная страница review** (клик по call title). Компоновка дословно: слева — плеер + внизу Notes/Add notes + AI Summary; справа — вкладки Insights / Stats / Transcript; сверху — Participants и Associations. Саммари делится на «purpose of the call, key discussion points, decisions made, sentiment, and next steps», шаблоны Auto/Support Rep/Sales Rep, кнопки like/dislike и копирования.
- Транскрипция (вкладка Transcript): дословно — «click the Transcript tab to view the call transcript. Use the search bar to lookup specific keywords»; «When you review transcripts, you can add threaded inline comments or share a link to a specific part of the transcript»; «To copy a transcript, on the Transcript tab, click Copy transcript to clipboard»; спикеры привязываются к контактам через Participants («click the link button next to the speaker… Link»). Stats: «Call owner talk time, Talk Speed (words per minute), Longest monologue, Longest customer story, Interactivity, Patience». Insights (Enterprise): tracked terms с категориями. Шаринг: Share с handles/Start-End для клипа («users with permission to view a recording clip can also listen to the entire recording»).
- Чего НЕТ: waveform; оценки-настроения шкалой (есть sentiment текстом в саммари); скачивания аудио в документации review-страницы (есть скачивание транскрипта; запись шарится ссылкой).

## 5. Aircall / Dialpad — список звонков + плеер + транскрипт

Источники Aircall:
- https://support.aircall.io/en-gb/articles/21534416528285 «Aircall Workspace: Call details»
- https://support.aircall.io/en-gb/articles/27713121042461 «Inbox settings»
- https://aircall.io/call-center-software-features/conversation-center
- https://developer.aircall.io/docs/log-transcriptions
Источники Dialpad:
- https://help.dialpad.com/docs/using-conversation-history
- https://www.dialpad.com/features/call-summary

- Список (Aircall Workspace): три вида — Conversations / Calls / Messages. Категории Calls view дословно: «Missed calls, Voicemails, Callback, Follow up, All». Conversation view: «Unread, Open, Assigned to you, Unassigned, Outbound, All». Conversation Center — «filterable log of all calls and voicemails… filters — including agent name, number, call date, and more». Call History в Dashboard — для админов/супервизоров с экспортом.
- Список (Dialpad Conversation History): таблица с настраиваемыми колонками («Select Edit, Select the eye icon to view or hide a column; The User and Contact Center column cannot be hidden»). Поля лога дословно: «call status, start date and time, duration, disposition… Duration Connected, CSAT, Grade, Call Summary and Options, Silent Time, Conversation ID». Фильтры: «offices or users, dates and times», «channel type», «direction».
- Результат звонка: у Aircall — пропущенные считаются только из входящих («Missed calls are calculated from inbound calls only»), у звонка есть «missed call reason» в Call details; у Dialpad — «call status» + «disposition» + CSAT/Grade. Цвет/иконка не документированы.
- Прослушивание: Aircall — плеер записи + транскрипт в развёрнутом «call bubble» и в детальном виде («Recording player and transcript»); Conversation Center — «one click access to all call recordings and transcripts». Dialpad — «Call Summary» со сниппетами и заметками, доступ к записи через «Call Summary and Options». Волна/скорость/«прослушано» ни у кого не документированы.
- Клик по звонку (Aircall): клик по call bubble в треде → развёрнутый вид: «Action items generated by AI or added manually; AI insights such as customer mood, key topics, and call summary; Voicemail recording and transcript; Tags and notes»; иконка Show call details → детальный вид: «Recording player and transcript; AI insights and action items; Call tags, notes, voicemail; Copy call ID». То есть звонок — узел внутри conversation thread, а не отдельная страница.
- Транскрипция (Aircall AI, нужен add-on AI Assist): дословно из dev-документации — «Speaker-separated transcript with timestamps and language detection», «Overall mood of each external participant — positive, neutral, or negative», «Tasks and follow-ups extracted», «key subjects… as short strings — e.g. billing, IVR setup». У Dialpad: «AI Summary», транскрипт с моментами (API: lines с name/time/type transcript|moment), «track AI Playbooks and Custom Moments usage», грейды и CSAT.
- Чего НЕТ: отдельной страницы звонка (у Aircall — панель внутри треда); waveform и скорости в документации; inline-комментариев к репликам (есть notes/tags на звонок целиком).

## 6. Gong / Fireflies — экран разбора разговора

Источники Gong:
- https://help.gong.io/docs/review-what-happened-in-a-call (Briefs)
- https://help.gong.io/view-a-call-transcript и https://help.gong.io/explore-call-content (обновлены 09–14.09.2026)
Источники Fireflies:
- https://guide.fireflies.ai/articles/9547055509 (Meeting Summaries)
- https://docs.fireflies.ai/schema/transcript.md

- Gong, страница звонка: слева панель с вкладками Briefs / Outline / Transcript / Call info / Points of interest; справа/сверху — плеер. Дословно: «an AI summary appears on the left side of the page, with a recap, key points and next steps»; «Click the Outline tab to see the call divided into clear sections… Click on the timestamp to go to that part»; «Transcript… attributed to each speaker… Selecting a line jumps the player»; «Search… Matching lines are highlighted»; «Select any part… create a snip and share… add a comment, or save to library». Points of interest: «Playbook mentions… Questions — purple for your side, pink for the customer… Trackers». Trackers двух типов: Smart (концепты, AI, кредитная модель) и Keyword (слова/фразы с настройками «said as part of a question / said at / said in topic»). Скачивание: Share → Download transcript (txt); перевод транскрипта с оговоркой «Search isn't available in translated transcripts».
- Fireflies: структура — Summary (Meeting Notes, Time-stamped Notes/chapters со ссылкой на транскрипт, Action Items с привязкой к спикерам) + Transcript (спикеры, таймкоды, клик = перемотка — подтверждается публичной вью-страницей с плеером 00:00/1×) + Analytics (sentiments %, categories: questions/date-times/metrics/tasks, speaker stats: duration/word count/filler words). API подтверждает поля: sentences {speaker_name, text, start_time}, summary {keywords, action_items, overview, topics_discussed, outline}. Оценки настроения — агрегированные проценты, не шкала на реплику.
- Чего НЕТ у обоих: колонок-списка звонков как в CRM (у Gong список — поиск/фильтры по трекерам, а не таблица); waveform как элемента интерфейса в документации нет (плеер с таймлайном и маркерами Points of interest вместо волны); скачивания аудио в один клик из транскрипта не документировано (у Gong — Download transcript; аудио — через сниппеты/шаринг).

---

## Общее место рынка (главный вывод)

1. Структура списка везде одинаковая: дата/время → направление (стрелка, не слово) → контакт/номер → сотрудник → длительность → результат → запись/плеер. Порядок колонок различается, состав — нет. Исключение — amoCRM, где списка нет вовсе.
2. Набор колонок ядра: дата, направление, от/кому, сотрудник, длительность, статус результата, запись. Всё остальное (стоимость, оценка, источник/канал, длительность ожидания) — второй эшелон, включается шестерёнкой/конструктором.
3. Поведение плеера: прослушивание — всегда в контексте (карточка/панель/страница звонка), никогда отдельной «аудиостраницей». Скорость есть только у коллтрекингов (Ringostat); waveform не документирован ни у одного из шести — везде прогресс-бар/таймлайн с маркерами. Скачивание — везде, кроме HubSpot review-страницы.
4. Устройство транскрипта: реплики по говорящим + таймкод + клик = перемотка + поиск — у всех, у кого транскрипция есть (HubSpot, Aircall, Gong, Fireflies, Ringostat-Pro). Саммари «итог + следующие шаги» — только у HubSpot/Gong/Fireflies/Aircall-AI; у телефоний/CRM (Битрикс24, Ringostat-база) — только текст. Настроение — текстом/процентами, не цветом на реплике. Inline-комментарии к реплике — только HubSpot и Gong.
5. Что делают единицы: отдельная страница звонка (Ringostat, HubSpot, Gong) vs звонок-как-событие в ленте (amoCRM, Aircall-bubble, Битрикс24-строка); оценка клиентом 1–5 (только Битрикс24); CSAT/Grade колла (только Dialpad); копирование VTT (только Ringostat); перевод транскрипта (только Gong); привязка спикера к контакту CRM (только HubSpot).
6. Чего не делает никто: waveform-плеера как обязательного элемента; отметки «прослушано»; SLA-таймера первого ответа в журнале; канбана звонков; свободного тегирования реплик внутри транскрипта (теги — на звонок целиком).

Источники датированы выше; все цитаты — дословные выдержки из указанных help-страниц.
