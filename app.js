import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, doc, getDocs, query, where, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const db = getFirestore(initializeApp(firebaseConfig));

// ---- Settings of the "business" (edit freely) ----
const SERVICES = [
  { id: "cut", name: "Classic haircut", minutes: 45, price: 25 },
  { id: "fade", name: "Skin fade", minutes: 60, price: 30 },
  { id: "beard", name: "Beard trim", minutes: 30, price: 15 },
  { id: "combo", name: "Haircut + beard", minutes: 75, price: 38 }
];
const OPEN_HOURS = ["10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
const DAYS_AHEAD = 14;
const CLOSED_WEEKDAYS = [0]; // 0 = Sunday

const state = { service: null, date: null, time: null };
const $ = (id) => document.getElementById(id);

// ---- Services ----
$("serviceList").innerHTML = SERVICES.map(s => `
  <div class="bg-ink rounded p-5 border border-white/5">
    <p class="font-display text-xl mb-1">${s.name}</p>
    <p class="text-white/50 text-sm mb-3">${s.minutes} min</p>
    <p class="text-brass font-bold text-2xl">€${s.price}</p>
  </div>`).join("");

$("serviceOptions").innerHTML = SERVICES.map(s => `
  <button type="button" data-service="${s.id}" class="opt text-left bg-steel border border-white/10 rounded px-4 py-3 hover:border-brass">
    <span class="font-semibold">${s.name}</span>
    <span class="float-right text-brass">€${s.price}</span>
  </button>`).join("");

document.querySelectorAll("[data-service]").forEach(btn => btn.onclick = () => {
  state.service = SERVICES.find(s => s.id === btn.dataset.service);
  highlight("[data-service]", btn);
  updateSummary();
});

// ---- Days ----
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const days = [];
for (let i = 0; days.length < DAYS_AHEAD && i < 30; i++) {
  const d = new Date(); d.setDate(d.getDate() + i);
  if (!CLOSED_WEEKDAYS.includes(d.getDay())) days.push(d);
}
$("dayOptions").innerHTML = days.map(d => `
  <button type="button" data-date="${toISO(d)}" class="opt shrink-0 w-16 bg-steel border border-white/10 rounded py-3 text-center hover:border-brass">
    <span class="block text-xs text-white/50">${d.toLocaleDateString("en-GB", { weekday: "short" })}</span>
    <span class="block font-display text-xl">${d.getDate()}</span>
    <span class="block text-xs text-white/50">${d.toLocaleDateString("en-GB", { month: "short" })}</span>
  </button>`).join("");

document.querySelectorAll("[data-date]").forEach(btn => btn.onclick = () => {
  state.date = btn.dataset.date;
  state.time = null;
  highlight("[data-date]", btn);
  loadTimes();
  updateSummary();
});

// ---- Times (reads which slots are already taken) ----
async function loadTimes() {
  const box = $("timeOptions");
  box.innerHTML = `<p class="col-span-full text-white/50 text-sm">Loading free times…</p>`;
  let taken = new Set();
  try {
    const snap = await getDocs(query(collection(db, "taken"), where("date", "==", state.date)));
    snap.forEach(d => taken.add(d.data().time));
  } catch (e) {
    console.error(e);
    box.innerHTML = `<p class="col-span-full text-red-400 text-sm">Could not load times. Check Firebase settings (see console).</p>`;
    return;
  }
  const now = new Date();
  box.innerHTML = OPEN_HOURS.map(t => {
    const past = state.date === toISO(now) && Number(t.slice(0, 2)) <= now.getHours();
    const off = taken.has(t) || past;
    return `<button type="button" data-time="${t}" ${off ? "disabled" : ""}
      class="opt bg-steel border border-white/10 rounded py-2 font-semibold hover:border-brass disabled:opacity-25 disabled:line-through disabled:hover:border-white/10">${t}</button>`;
  }).join("");
  box.querySelectorAll("[data-time]").forEach(btn => btn.onclick = () => {
    state.time = btn.dataset.time;
    highlight("[data-time]", btn);
    updateSummary();
  });
}

// ---- Helpers ----
function highlight(selector, active) {
  document.querySelectorAll(selector).forEach(b => {
    b.classList.toggle("border-brass", b === active);
    b.classList.toggle("bg-brass/10", b === active);
  });
}

function updateSummary() {
  const { service, date, time } = state;
  if (!service && !date) { $("summary").textContent = "Nothing selected yet."; return; }
  const parts = [];
  if (service) parts.push(`<strong>${service.name}</strong> · €${service.price}`);
  if (date) parts.push(new Date(date + "T12:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }));
  if (time) parts.push(`at <strong>${time}</strong>`);
  $("summary").innerHTML = parts.join(" — ");
}

function showMessage(text, ok) {
  const m = $("message");
  m.textContent = text;
  m.className = "text-center text-sm " + (ok ? "text-green-400" : "text-red-400");
}

// ---- Submit: writes the booking and blocks the slot in one transaction ----
$("bookingForm").onsubmit = async (e) => {
  e.preventDefault();
  const { service, date, time } = state;
  const name = $("name").value.trim();
  const phone = $("phone").value.trim();
  if (!service || !date || !time) { showMessage("Please choose a service, a day and a time.", false); return; }
  if (!name || !phone) { showMessage("Please enter your name and phone.", false); return; }

  $("submitBtn").disabled = true;
  try {
    const batch = writeBatch(db);
    batch.set(doc(db, "taken", `${date}_${time.replace(":", "")}`), { date, time });
    batch.set(doc(collection(db, "bookings")), {
      name, phone, service: service.name, date, time, status: "new", createdAt: serverTimestamp()
    });
    await batch.commit();
    showMessage(`Booked! See you on ${date} at ${time}.`, true);
    $("bookingForm").reset();
    state.service = state.time = null;
    document.querySelectorAll(".opt").forEach(b => b.classList.remove("border-brass", "bg-brass/10"));
    await loadTimes();
    updateSummary();
  } catch (err) {
    console.error(err);
    showMessage("Sorry, this time was just taken or the booking failed. Please pick another time.", false);
    await loadTimes();
  } finally {
    $("submitBtn").disabled = false;
  }
};

$("year").textContent = new Date().getFullYear();
