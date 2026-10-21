// Callout icon picker (notion-parity C6), lazy: about 200 common emoji searchable by English/Korean keywords,
// the last 8 picks (localStorage), and 아이콘 없애기. open(anchor, current, done): done(icon) on pick, done("") on remove;
// Esc or a click outside closes without calling done, so nothing is saved.
(function () {
  "use strict";
  var editor = window.AcardEditor;
  if (!editor) return;
  var LIST = "😀 smile grin 웃음|😂 laugh joy 웃김|😊 happy blush 행복|😍 love heart eyes|🤔 think 생각|😎 cool sunglasses 멋짐|😢 sad cry 슬픔|😡 angry 화남|😴 sleep 잠|🤯 mind blown 충격|🥳 party 파티 축하|😇 angel 천사|🙏 pray thanks 감사|👍 thumbs up good|👎 thumbs down bad|👏 clap 박수|🙌 hooray 만세|💪 strong muscle 힘|👀 eyes look 보기|👋 wave hello 안녕|🤝 handshake deal 협력|✌️ peace victory 승리|👉 point right 오른쪽|👈 point left 왼쪽|☝️ point up 위|✍️ write 쓰기|🧠 brain 두뇌 생각|❤️ heart red love|🧡 orange heart 주황|💛 yellow heart 노랑|💚 green heart 초록|💙 blue heart 파랑|💜 purple heart 보라|🖤 black heart 검정|🤍 white heart 흰|💔 broken heart 이별|💯 hundred 백점|🔥 fire hot 불|⭐ star 별|🌟 glowing star 반짝|✨ sparkles 반짝|⚡ lightning bolt 번개|💡 idea bulb 아이디어|📌 pin 핀 고정|📍 location pin 위치|📎 clip 클립 첨부|🔗 link 링크|📝 memo note 메모|📒 notebook 노트|📓 notebook 공책|📔 notebook 다이어리|📕 book red 책|📗 book green 책|📘 book blue 책|📙 book orange 책|📚 books 책 공부|📖 open book 독서|🗒️ notepad 메모장|🗓️ calendar 달력 일정|📅 date calendar 날짜|📆 calendar 일정|⏰ alarm clock 알람|⏳ hourglass 기다림|⌛ hourglass 시간|🕒 clock 시계|⏱️ stopwatch 타이머|📊 chart bar 차트|📈 chart up 상승|📉 chart down 하락|📋 clipboard 클립보드 목록|✅ check done 완료|☑️ check box 체크|✔️ check mark 확인|❌ cross no 취소|❎ cross 엑스|⚠️ warning 경고 주의|🚫 forbidden 금지|⛔ no entry 금지|❗ exclamation 느낌표 중요|❓ question 물음표 질문|❔ question 질문|ℹ️ info 정보|🆕 new 새로|🆗 ok 확인|🔔 bell 알림|🔕 mute 무음|📣 megaphone 공지 알림|📢 loudspeaker 공지|💬 speech chat 대화|💭 thought 생각|🗨️ comment 댓글|📧 email mail 메일|📩 inbox mail 받은|📨 mail 편지|📮 postbox 우편|📦 package box 상자|🎁 gift 선물|🎉 tada party 축하|🎊 confetti 축하|🎈 balloon 풍선|🎂 cake birthday 생일|🏆 trophy 트로피 우승|🥇 gold medal 금메달|🎯 target goal 목표|🚀 rocket launch 로켓|✈️ airplane 비행기 여행|🚗 car 자동차|🚲 bike 자전거|🏠 house home 집|🏢 office building 회사|🏫 school 학교|🏥 hospital 병원|🗺️ map 지도|🧭 compass 나침반 방향|🌍 earth world 지구|🌏 globe asia 지구|☀️ sun 해 맑음|🌙 moon 달 밤|☁️ cloud 구름|🌧️ rain 비|❄️ snow 눈 겨울|🌈 rainbow 무지개|🌊 wave sea 바다|🌱 seedling sprout 새싹|🌿 herb 풀|🍀 clover luck 행운|🌸 cherry blossom 벚꽃|🌻 sunflower 해바라기|🌹 rose 장미|🍁 maple 단풍 가을|🌲 tree 나무|🍎 apple 사과|🍊 orange 귤|🍋 lemon 레몬|🍓 strawberry 딸기|🍉 watermelon 수박|🍞 bread 빵|🍕 pizza 피자|🍔 burger 햄버거|🍜 noodle 라면|🍣 sushi 초밥|🍚 rice 밥|☕ coffee 커피|🍵 tea 차|🍺 beer 맥주|🍷 wine 와인|🐶 dog 강아지|🐱 cat 고양이|🐰 rabbit 토끼|🐻 bear 곰|🐼 panda 판다|🦊 fox 여우|🐯 tiger 호랑이|🦁 lion 사자|🐸 frog 개구리|🐧 penguin 펭귄|🐥 chick 병아리|🦋 butterfly 나비|🐝 bee 벌|🐢 turtle 거북 느림|🐳 whale 고래|💻 laptop computer 컴퓨터|🖥️ desktop 컴퓨터|⌨️ keyboard 키보드|🖱️ mouse 마우스|📱 phone mobile 휴대폰|☎️ telephone 전화|📷 camera 카메라 사진|🎥 movie camera 영상|🎬 clapper film 영화|🎧 headphone 음악|🎵 music note 음악|🎮 game 게임|🎨 art palette 그림|🖌️ brush 붓|✏️ pencil 연필|🖊️ pen 펜|📐 ruler 자 설계|✂️ scissors 가위|🔒 lock 잠금 보안|🔓 unlock 열림|🔑 key 열쇠|🛠️ tools 도구 수리|🔧 wrench 렌치 설정|🔨 hammer 망치|⚙️ gear settings 설정|🧪 test tube 실험|🔬 microscope 연구|🧩 puzzle 퍼즐|🧲 magnet 자석|💰 money bag 돈|💵 dollar 달러|💳 card 카드 결제|🧾 receipt 영수증|🛒 cart shopping 장바구니|🏷️ tag label 태그|📁 folder 폴더|📂 open folder 폴더|🗂️ dividers 분류|🗃️ card box 보관".split("|").map(function (row) { var at = row.indexOf(" "); return { e: row.slice(0, at), k: row.slice(at + 1).toLowerCase() }; });
  var RECENT = "acard-icon-recent";
  var box = null, back = null;
  function recent() { try { return JSON.parse(localStorage.getItem(RECENT) || "[]").slice(0, 8); } catch (e) { return []; } }
  function remember(icon) { try { localStorage.setItem(RECENT, JSON.stringify([icon].concat(recent().filter(function (x) { return x !== icon; })).slice(0, 8))); } catch (e) {} }
  function close() {
    if (!box) return;
    box.remove(); box = null;
    document.removeEventListener("pointerdown", outside, true);
    if (back && back.focus) back.focus();
  }
  function outside(ev) { if (box && !box.contains(ev.target)) close(); }
  function open(anchor, current, done) {
    close();
    back = anchor;
    box = document.createElement("div");
    box.className = "icon-picker"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "아이콘 고르기");
    var search = document.createElement("input");
    search.type = "search"; search.className = "ip-search"; search.placeholder = "아이콘 찾기 (예: fire, 불)"; search.setAttribute("aria-label", "아이콘 찾기");
    var remove = document.createElement("button");
    remove.type = "button"; remove.className = "ip-remove"; remove.textContent = "아이콘 없애기";
    remove.addEventListener("click", function () { close(); done(""); });
    var head = document.createElement("div"); head.className = "ip-head"; head.appendChild(search); head.appendChild(remove);
    var grid = document.createElement("div"); grid.className = "ip-grid";
    function cell(icon) {
      var b = document.createElement("button");
      b.type = "button"; b.className = "ip-cell" + (icon === current ? " on" : ""); b.textContent = icon; b.setAttribute("aria-label", icon);
      b.addEventListener("click", function () { remember(icon); close(); done(icon); });
      return b;
    }
    function draw() {
      var q = search.value.trim().toLowerCase();
      grid.innerHTML = "";
      var rec = q ? [] : recent();
      if (rec.length) { var t = document.createElement("p"); t.className = "ip-label"; t.textContent = "최근"; grid.appendChild(t); rec.forEach(function (x) { grid.appendChild(cell(x)); }); var t2 = document.createElement("p"); t2.className = "ip-label"; t2.textContent = "전체"; grid.appendChild(t2); }
      var hits = LIST.filter(function (x) { return !q || x.k.indexOf(q) >= 0 || x.e === q; });
      hits.forEach(function (x) { grid.appendChild(cell(x.e)); });
      if (!hits.length) { var none = document.createElement("p"); none.className = "ip-label"; none.textContent = "맞는 아이콘이 없어요"; grid.appendChild(none); }
    }
    search.addEventListener("input", draw);
    box.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); return; }
      if (ev.key === "Enter" && ev.target === search) { ev.preventDefault(); var first = grid.querySelector(".ip-cell"); if (first) first.click(); }
    });
    box.appendChild(head); box.appendChild(grid);
    document.body.appendChild(box);
    draw();
    var rect = anchor.getBoundingClientRect();
    box.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - box.offsetWidth - 8)) + "px";
    box.style.top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - box.offsetHeight - 8)) + "px";
    search.focus();
    setTimeout(function () { document.addEventListener("pointerdown", outside, true); }, 0);
  }
  editor.provide("icon-picker", { open: open, close: close, list: LIST });
})();
