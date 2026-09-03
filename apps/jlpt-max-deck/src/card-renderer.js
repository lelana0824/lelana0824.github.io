import DOMPurify from 'dompurify';
import { audioFilename } from './apkg.js';

const PURIFY_OPTIONS = {
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['style'],
};

export function cleanHtml(html = '') {
  return DOMPurify.sanitize(html, PURIFY_OPTIONS);
}

function section(label, content, className = '') {
  if (!content) return '';
  return `<section class="answer-section ${className}"><h3>${label}</h3>${content}</section>`;
}

export function cardView(card, revealed) {
  const fields = card.fields || {};
  if (card.modelName.includes('어휘문제')) {
    const prompt = revealed ? fields.PromptRuby || fields.PromptJP : fields.PromptJP;
    const choices = revealed ? fields.ChoicesRubyHTML || fields.ChoicesHTML : fields.ChoicesHTML;
    return {
      kind: 'practice',
      title: fields.QuestionLabel || '실전 문제',
      level: fields.JLPT || '',
      audio: audioFilename(fields.AnswerAudio),
      front: cleanHtml(`
        <p class="card-instruction">${fields.Instruction || ''}</p>
        <div class="practice-prompt" lang="ja">${prompt || ''}</div>
        <div class="practice-choices">${choices || ''}</div>
      `),
      back: revealed ? cleanHtml(`
        ${fields.PromptKORuby ? `<p class="translation">${fields.PromptKORuby}</p>` : ''}
        <div class="answer-key"><strong lang="ja">${fields.AnswerRuby || fields.AnswerJP || ''}</strong><span>${fields.AnswerKORuby || fields.AnswerKO || ''}</span></div>
        ${section('해설', fields.ExplanationRubyHTML || fields.ExplanationHTML)}
      `) : '',
    };
  }

  if (card.modelName.includes('문법')) {
    return {
      kind: 'grammar',
      title: '문법',
      level: fields.Level || '',
      audio: '',
      front: cleanHtml(`<div class="grammar-front">${fields.FrontHTML || ''}</div>`),
      back: revealed ? cleanHtml(`<div class="grammar-back">${fields.BackHTML || ''}</div>`) : '',
    };
  }

  const frontWord = card.order === 3 ? fields.KoreanRecallPrompt : fields.Word;
  return {
    kind: 'vocabulary',
    title: fields.PartOfSpeech || '어휘',
    level: fields.JLPT || fields.WordJLPT || '',
    audio: audioFilename(fields.WordAudioFile || fields.WordAudio),
    front: cleanHtml(`<div class="word-front" lang="ja">${frontWord || fields.Word || ''}</div>`),
    back: revealed ? cleanHtml(`
      <div class="word-reading" lang="ja">${fields.Reading || ''}</div>
      <div class="word-meaning">${fields.MeaningV2 || fields.Meaning || ''}</div>
      ${fields.UsageRegister ? `<div class="usage-register">${fields.UsageRegister}</div>` : ''}
      ${section('예문', fields.ExamplesRendered, 'examples')}
      ${fields.ConjugationDetails || ''}
      ${fields.UsageDetails || ''}
      ${fields.WordFormationDetails || ''}
      ${fields.RelatedWords || ''}
      ${fields.KanjiDetails || ''}
    `) : '',
  };
}
