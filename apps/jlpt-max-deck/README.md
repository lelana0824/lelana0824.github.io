# JLPT MAX 모바일 웹앱

공식 JLPT MAX APKG를 브라우저 밖으로 전송하지 않고 기기에서 직접 읽어 학습하는 정적 웹앱입니다. GitHub Pages에서는 앱 코드만 배포하며 카드 데이터와 음성은 다시 묶거나 복제하지 않습니다.

## 저장 경계

- 목표 급수, 하루 학습량, 카드별 복습 일정, 일일 학습 수는 `localStorage`에 저장합니다.
- APKG는 약 1.15GB이므로 `localStorage` 용량에 들어가지 않습니다. 지원 브라우저에서는 Origin Private File System에 원본 파일을 그대로 보관하고, 지원하지 않거나 공간이 부족하면 현재 브라우저 세션에서만 사용합니다.
- 카드와 음성은 APKG의 ZIP 색인을 이용해 필요한 부분만 읽습니다. 서버 업로드나 외부 API 호출은 없습니다.

## 개발과 검사

```text
npm ci
npm test
npm run build
```

빌드 결과는 `static/jlpt-max-deck/`에 생성됩니다. Gatsby 사이트를 빌드하면 이 디렉터리가 `/jlpt-max-deck/` 경로로 복사되므로 기존 블로그와 함께 배포됩니다.
