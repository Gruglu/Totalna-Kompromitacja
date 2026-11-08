// Zasady czytane przed pierwszą rundą. Każda zasada ma krótką wersję na planszę
// ("board") i pełny tekst dla prowadzącego ("host"), który czyta się na głos.
// Zestaw pytań może podać własne "rules" w tym samym kształcie i wtedy zastępują te.
import { ANSWER_SECONDS, FINAL_SECONDS, DD_MIN, DD_PER_ROUND, PUNISH_DAYS, mediaRefs } from './engine.js';

const plural = (n, one, few, many) => {
  if (n === 1) return one;
  const d = n % 10;
  const dd = n % 100;
  return d >= 2 && d <= 4 && (dd < 12 || dd > 14) ? few : many;
};

export function rulesFor(set) {
  if (Array.isArray(set?.rules) && set.rules.length) return set.rules;
  return defaultRules(set);
}

export function defaultRules(set) {
  const rounds = set?.rounds || [];
  const R = rounds.length;
  const r1 = rounds[0];
  const cols = r1?.categories?.length || 6;
  const rows = r1?.values?.length || 5;
  const v1 = r1?.values || [100, 500];
  const dd = rounds.map((r, i) => r.dailyDoubles ?? DD_PER_ROUND[i] ?? 1);
  const ddTxt = dd.map((n, i) => `${n} w rundzie ${i + 1}`).join(', ');
  const refs = mediaRefs(set);
  const hasImg = refs.some((m) => m.field === 'image');
  const hasAudio = refs.some((m) => m.field === 'audio');
  const list = [];

  list.push({
    title: 'Jak to działa',
    board: [
      `${R} ${plural(R, 'runda', 'rundy', 'rund')}, w każdej plansza ${cols} × ${rows}`,
      `stawki od ${v1[0]} do ${v1[v1.length - 1]}, potem podwójne`,
      'na koniec finał z zakładem',
    ],
    host: `Słuchajcie, bo powtarzać nie będę. Gramy ${R} ${plural(R, 'rundę', 'rundy', 'rund')}. W każdej jest plansza: ${cols} kategorii, po ${rows} pytań, od ${v1[0]} do ${v1[v1.length - 1]} punktów. Im droższe pole, tym boleśniej. W drugiej rundzie stawki rosną dwa razy, więc kto przerżnie pierwszą, ma jeszcze szansę przerżnąć drugą. Na końcu finał, w którym obstawiacie własne punkty.`,
  });

  list.push({
    title: 'Wybieranie',
    board: ['kto wybiera, podaje na głos kategorię i stawkę', 'kto trafi, wybiera następne pole', 'pierwszy wybierający jest losowany'],
    host: 'Osoba podświetlona na dole ekranu wybiera pole. Mówi na głos kategorię i stawkę, ja klikam. Kto odpowie dobrze, przejmuje wybieranie. Pierwszą osobę losuje maszyna, więc nie macie do kogo mieć pretensji. Poza mną.',
  });

  list.push({
    title: 'Buzzery',
    board: ['czytam pytanie do końca', 'dopiero wtedy otwieram buzzery', 'za wcześnie = sekunda blokady'],
    host: 'Najpierw czytam pytanie do końca. Buzzery otwierają się dopiero wtedy, kiedy ja tak zdecyduję, ekran pokaże „Buzzery otwarte”. Kto wciśnie za wcześnie, ma sekundę blokady i patrzy, jak ktoś inny zgarnia punkty. Liczy się kolejność, w jakiej sygnał doleciał do mnie, a nie Wasze zdanie na ten temat.',
  });

  list.push({
    title: 'Odpowiedź',
    board: [`${ANSWER_SECONDS} sekund od zgłoszenia`, 'dobrze: zgarniasz stawkę', 'źle: stawka idzie na minus, reszta może przejąć'],
    host: `Kto się zgłosi, ma ${ANSWER_SECONDS} sekund na odpowiedź na głos. Dobrze: dostajecie wartość pola. Źle: tyle samo idzie na minus, a buzzery otwierają się dla reszty. Tak, można zejść poniżej zera. Tak, liczę na to. Jak nikt nie wie, pokazuję odpowiedź i wszyscy się wstydzimy razem.`,
  });

  list.push({
    title: 'Sędzia',
    board: ['prawie dobrze może dać połowę', 'decyzja prowadzącego jest ostateczna', 'odwołania przyjmuję po odcinku, czyli nigdy'],
    host: 'Oceniam ja. Odpowiedź prawie dobra może dostać połowę punktów, jeśli będę w dobrym humorze, a nie będę. Przejęzyczenia wybaczam, brak wiedzy nie. Moja decyzja jest ostateczna, a reklamacje przyjmuję po odcinku, w okienku, którego nie ma.',
  });

  list.push({
    title: 'Wszystko albo nic',
    board: [`ukryte pola: ${dd.map((n, i) => `${n} w R${i + 1}`).join(', ')}`, 'gra tylko ten, kto je wybrał', `stawka od ${DD_MIN} do całego wyniku`],
    host: `Na planszy są ukryte pola „wszystko albo nic”: ${ddTxt}. Kto na nie trafi, gra sam. Najpierw stawia, od ${DD_MIN} punktów do całego swojego wyniku, a jak ma mało, to do najwyższej stawki na planszy. Potem dopiero widzi pytanie. Stawkę wpisujecie na telefonie albo mówicie mi na głos. Odwaga jest opcjonalna, wstyd obowiązkowy.`,
  });

  if (hasImg || hasAudio) {
    const b = [];
    if (hasImg) b.push('obrazek pojawia się razem z pytaniem, dotknij, żeby powiększyć');
    if (hasAudio) b.push('muzykę puszczam ja, możecie zgłaszać się w trakcie');
    b.push('buzzery otwieram jak zwykle, gdy skończę czytać');
    const h = [];
    if (hasImg) h.push('Niektóre pytania mają obrazek, pokaże się u Was na ekranie razem z treścią. Na telefonie dotknij go, żeby powiększyć.');
    if (hasAudio) h.push('W niektórych puszczam fragment muzyki. Gra u Was na urządzeniach, steruję tym ja, więc jak nic nie słychać, to sprawdźcie głośność, a nie mnie. Jak tylko otworzę buzzery, możecie się zgłaszać, nawet jeśli muzyka jeszcze leci.');
    h.push('Zasady punktowania są te same.');
    list.push({ title: hasAudio ? 'Obrazki i muzyka' : 'Obrazki', board: b, host: h.join(' ') });
  }

  if (R > 1) {
    list.push({
      title: 'Kolejne rundy',
      board: ['stawki w górę', 'zaczyna najniższy wynik', 'czyli ten, komu jest najbardziej wstyd'],
      host: 'Kolejną rundę zaczyna osoba z najniższym wynikiem. To nie nagroda, to akt litości. Stawki rosną, więc minusy też.',
    });
  }

  if (set?.final) {
    list.push({
      title: 'Finał',
      board: ['grają tylko wyniki powyżej zera', 'zakład od 0 do całego wyniku', `${FINAL_SECONDS} s na wpisanie odpowiedzi na telefonie`],
      host: `Do finału wchodzą tylko osoby z dodatnim wynikiem. Reszta patrzy i cierpi. Najpierw poznajecie kategorię i obstawiacie na telefonie, od zera do wszystkiego, co macie. Potem pokazuję pytanie i macie ${FINAL_SECONDS} sekund na wpisanie odpowiedzi. Dobrze: dostajecie zakład. Źle: zakład znika. Odsłaniamy od najniższego wyniku.`,
    });
  }

  list.push({
    title: 'Kara',
    board: ['zwycięzca wybiera nick i avatar dla ostatniego miejsca', `obowiązuje ${PUNISH_DAYS} dni`, 'bez zmieniania z powrotem, bez negocjacji'],
    host: `Teraz najważniejsze. Kto wygra, dostaje władzę nad tym, kto będzie ostatni: wybiera tej osobie nowy nick i nowy avatar na Discordzie. Obowiązuje ${PUNISH_DAYS} dni. Nie zmieniacie z powrotem, nie negocjujecie, nie płaczecie na kanale. A najgłupsza odpowiedź wieczoru trafia do Hall of Shame i zostaje tam na zawsze, więc zastanówcie się dwa razy, zanim coś powiecie. Albo nie, mnie to bawi.`,
  });

  list.push({
    title: 'Na koniec',
    board: ['wygrywa najwyższy wynik', 'punkty idą do rankingu sezonu', 'top 3 sezonu gra w wielkim finale'],
    host: 'Kto ma najwięcej punktów, wygrywa odcinek i może się chwalić do następnego. Punkty z każdego odcinka sumują się w rankingu sezonu, a trójka z góry tabeli zagra na koniec w finale sezonu. Reszta będzie patrzeć. Telefony w dłoń, zaczynamy.',
  });

  return list;
}
