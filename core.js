export const purposes = {
  study: {name:'Учёба', description:'Студенческие визы и образование за рубежом'},
  work: {name:'Работа', description:'Рабочие визы и легальное трудоустройство'},
  tourism: {name:'Туризм', description:'Туристические визы и подготовка к поездке'},
  other: {name:'Другое', description:'Индивидуальные визовые и релокационные задачи'}
};
export const normalize = value => String(value || '').trim().toLocaleLowerCase('ru').replaceAll('ё','е');
export function findCountry(countries, value) {
  return countries.find(c => normalize(c.name) === normalize(value) || normalize(c.id) === normalize(value));
}
export function contactError(channel, value) {
  const v = value.trim();
  if(channel === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? '' : 'Введите email, например name@example.com.';
  const digits=v.replace(/\D/g,'');
  const phone=/^\+?[1-9][\d ()-]{6,23}$/.test(v)&&digits.length>=7&&digits.length<=15;
  if(channel === 'whatsapp') return phone ? '' : 'Введите номер WhatsApp с кодом страны.';
  return /^(?:@|https:\/\/t\.me\/)[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(v) || phone ? '' : 'Введите @username (от 5 символов) или номер телефона с кодом страны.';
}
export function contactHref(channel, value) {
  if (!value) return null;
  const v = String(value).trim();
  if (channel === 'telegram') {
    const handle = v.replace(/^https:\/\/t\.me\//,'').replace(/^@/,'').replace(/\/$/,'');
    return /^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(handle) ? 'https://t.me/'+handle : null;
  }
  if (channel === 'whatsapp') {
    const number = v.replace(/^https:\/\/wa\.me\//,'').replace(/[ +()-]/g,'');
    return /^\d{7,15}$/.test(number) ? 'https://wa.me/'+number : null;
  }
  if (channel === 'email' && !contactError('email',v)) return 'mailto:'+v;
  return null;
}
export function safeImage(value) {
  if (typeof value !== 'string') return 'assets/alpine-journey-poster.jpg';
  return /^assets\/[a-zA-Z0-9_./-]+\.(jpg|jpeg|png|webp)$/.test(value) && !value.includes('..') ? value : 'assets/alpine-journey-poster.jpg';
}
export function safeApiBase(value, origin) {
  if (!value) return null;
  try {const url=new URL(value,origin); return (url.protocol==='https:' || (url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname))) && !url.username && !url.password ? url.href.replace(/\/$/,'') : null;} catch {return null;}
}
