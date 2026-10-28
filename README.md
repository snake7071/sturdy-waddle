## sturdy-waddle

*[🇷🇺 Описание на русском языке находится ниже](#русская-версия)*

Recently, there have been many attempts to create AI assistants, but most of them come with various issues and are hidden behind paywalls. My main goal is to build an assistant that will help you with your daily tasks and become a reliable companion, no matter what field you work in.

This project is open-source, and anyone can use it absolutely for free. I also warmly welcome any enthusiasts who want to contribute and help the project grow.

## 🏗️ Architecture

Architecturally, the assistant is divided into three core components:

1. **Frontend (Appearance)**: Built with Tauri or Flutter. It features a transparent window with two avatar modes: an energy-efficient 2D mode (PNGTuber sprites/Live2D) and a 3D mode for VRM models. The UI also includes a chat, widgets, and a visual node-based editor.
2. **Brain (Logic & AI)**: Built with Rust or Python. It uses a unified API layer to switch seamlessly between local LLMs (Ollama/Llama.cpp) and cloud APIs (OpenAI, Gemini). It includes intelligent memory management (short-term context and long-term vector database) and tool calling capabilities.
3. **Functionality**: Securely integrates with the OS for file access, app launching, and hotkeys. Includes a command dispatcher, safety sandboxing, MCP plugin support, and remote control via Telegram.

All implementation details and documentation will be provided in the corresponding directories for each core branch of the project.

## 🗺️ Roadmap

- **Phase 1: Core & AI**: Tech stack selection, basic chat UI, LLM/Ollama integrations, JSON command parser.
- **Phase 2: Avatar & UI**: Transparent desktop window setup, 2D avatar mode, 3D VRM rendering.
- **Phase 3: Automation**: STT/TTS (Speech-to-Text / Text-to-Speech) integration, macros, visual node editor.
- **Phase 4: Ecosystem**: Telegram bot integration, cross-platform testing (Windows + Linux), open-source release.

## 🤝 Contributing
Contributions are always welcome! Feel free to open issues or submit Pull Requests.

## 📄 License
This project is licensed under the **GNU GPL-3.0** License.

---

# 🇷🇺 Русская версия

В последнее время появляется всё больше попыток создать AI-ассистентов, однако большинство из них имеют ряд проблем и распространяются по платной модели. Моя главная цель — сделать ассистента, который поможет вам с повседневными задачами и станет верным помощником, в какой бы области вы ни работали. 

Проект распространяется под открытой лицензией, и каждый может использовать его абсолютно бесплатно. Я также буду рад любым энтузиастам, которые захотят присоединиться к разработке и помочь развитию проекта.

## 🏗️ Архитектура системы

Архитектурно ассистент разделен на три основных смысловых блока:

1. **Frontend (Внешний вид)**: Фреймворк Tauri или Flutter. Прозрачное окно с двумя режимами: энергоэффективный 2D (спрайты/Live2D) и 3D (VRM-модели). Интерфейс включает окно чата, виджеты (погода, задачи) и визуальный редактор узлов для команд.
2. **Мозг (Логика и ИИ)**: Написан на Rust или Python. Единый API для работы с локальными (Ollama) и облачными LLM (OpenAI, Gemini). Управление краткосрочной памятью диалога и долгосрочной памятью через векторную базу данных. Интеллектуальная маршрутизация (Tool Calling).
3. **Функционал**: Доступ к ОС для чтения/записи файлов, запуска приложений и эмуляции клавиш. Включает обработку цепочек команд, песочницу для безопасности, систему плагинов (MCP) и интеграцию с Telegram-ботом.

Все детали реализации и документация будут находиться в соответствующих директориях для каждой смысловой ветки проекта.

## 🗺️ План разработки (Roadmap)

- **Этап 1: Фундамент (Core & AI)**: Выбор стека технологий, реализация чата, подключение API (LLM) и локального Ollama, написание парсера JSON-команд.
- **Этап 2: Визуальная часть (Аватар и UI)**: Создание прозрачного окна поверх других, реализация 2D-режима и 3D-режима.
- **Этап 3: Автоматизация (Голос и Система)**: Прикручивание распознавания (STT) и синтеза речи (TTS), разработка системы макросов, основы визуального редактора команд (Nodes).
- **Этап 4: Экосистема (Удаленка и Плагины)**: Интеграция Telegram-бота, кроссплатформенное тестирование (Windows + Linux), подготовка релизной Open-Source версии.

## 🤝 Как помочь проекту
Мы рады любым пулл-реквестам! 

## 📄 Лицензия
Проект распространяется под лицензией **GNU GPL-3.0**.
