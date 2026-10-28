## sturdy-waddle

*[🇷🇺 Описание на русском языке находится ниже](#русская-версия)*

Recently, there have been many attempts to create AI assistants, but most of them come with various issues and are hidden behind paywalls. My main goal is to build an assistant that will help you with your daily tasks and become a reliable companion, no matter what field you work in.

This project is open-source, and anyone can use it absolutely for free. I also warmly welcome any enthusiasts who want to contribute and help the project grow.

## 🏗️ Architecture

Architecturally, the assistant is divided into three core components[cite: 2]:

1. **Frontend (Appearance)**: Built with Tauri or Flutter[cite: 1]. It features a transparent window with two avatar modes: an energy-efficient 2D mode (PNGTuber sprites/Live2D) and a 3D mode for VRM models[cite: 1, 2]. The UI also includes a chat, widgets, and a visual node-based editor[cite: 1, 2].
2. **Brain (Logic & AI)**: Built with Rust or Python[cite: 1]. It uses a unified API layer to switch seamlessly between local LLMs (Ollama/Llama.cpp) and cloud APIs (OpenAI, Gemini)[cite: 1, 2]. It includes intelligent memory management (short-term context and long-term vector database) and tool calling capabilities[cite: 2].
3. **Functionality**: Securely integrates with the OS for file access, app launching, and hotkeys[cite: 2]. Includes a command dispatcher, safety sandboxing, MCP plugin support, and remote control via Telegram[cite: 1, 2].

All implementation details and documentation will be provided in the corresponding directories for each core branch of the project.

## 🗺️ Roadmap

- **Phase 1: Core & AI**: Tech stack selection, basic chat UI, LLM/Ollama integrations, JSON command parser[cite: 1].
- **Phase 2: Avatar & UI**: Transparent desktop window setup, 2D avatar mode, 3D VRM rendering[cite: 1].
- **Phase 3: Automation**: STT/TTS (Speech-to-Text / Text-to-Speech) integration, macros, visual node editor[cite: 1].
- **Phase 4: Ecosystem**: Telegram bot integration, cross-platform testing (Windows + Linux), open-source release[cite: 1].

## 🤝 Contributing
Contributions are always welcome! Feel free to open issues or submit Pull Requests.

## 📄 License
This project is licensed under the **GNU GPL-3.0** License.

---

# 🇷🇺 Русская версия

В последнее время появляется всё больше попыток создать AI-ассистентов, однако большинство из них имеют ряд проблем и распространяются по платной модели. Моя главная цель — сделать ассистента, который поможет вам с повседневными задачами и станет верным помощником, в какой бы области вы ни работали. 

Проект распространяется под открытой лицензией, и каждый может использовать его абсолютно бесплатно. Я также буду рад любым энтузиастам, которые захотят присоединиться к разработке и помочь развитию проекта.

## 🏗️ Архитектура системы

Архитектурно ассистент разделен на три основных смысловых блока[cite: 2]:

1. **Frontend (Внешний вид)**: Фреймворк Tauri или Flutter[cite: 1]. Прозрачное окно с двумя режимами: энергоэффективный 2D (спрайты/Live2D) и 3D (VRM-модели)[cite: 1, 2]. Интерфейс включает окно чата, виджеты (погода, задачи) и визуальный редактор узлов для команд[cite: 1, 2].
2. **Мозг (Логика и ИИ)**: Написан на Rust или Python[cite: 1]. Единый API для работы с локальными (Ollama) и облачными LLM (OpenAI, Gemini)[cite: 1, 2]. Управление краткосрочной памятью диалога и долгосрочной памятью через векторную базу данных[cite: 2]. Интеллектуальная маршрутизация (Tool Calling)[cite: 2].
3. **Функционал**: Доступ к ОС для чтения/записи файлов, запуска приложений и эмуляции клавиш[cite: 2]. Включает обработку цепочек команд, песочницу для безопасности, систему плагинов (MCP) и интеграцию с Telegram-ботом[cite: 1, 2].

Все детали реализации и документация будут находиться в соответствующих директориях для каждой смысловой ветки проекта.

## 🗺️ План разработки (Roadmap)

- **Этап 1: Фундамент (Core & AI)**: Выбор стека технологий, реализация чата, подключение API (LLM) и локального Ollama, написание парсера JSON-команд[cite: 1].
- **Этап 2: Визуальная часть (Аватар и UI)**: Создание прозрачного окна поверх других, реализация 2D-режима и 3D-режима[cite: 1].
- **Этап 3: Автоматизация (Голос и Система)**: Прикручивание распознавания (STT) и синтеза речи (TTS), разработка системы макросов, основы визуального редактора команд (Nodes)[cite: 1].
- **Этап 4: Экосистема (Удаленка и Плагины)**: Интеграция Telegram-бота, кроссплатформенное тестирование (Windows + Linux), подготовка релизной Open-Source версии[cite: 1].

## 🤝 Как помочь проекту
Мы рады любым пулл-реквестам! 

## 📄 Лицензия
Проект распространяется под лицензией **GNU GPL-3.0**.
