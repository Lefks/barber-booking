import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, getDocs, doc, updateDoc, deleteDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = (id) => document.getElementById(id);
let bookings = [];

// Escape text typed by clients before showing it (protects the admin page)
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const STATUS_STYLE = {
  new: "bg-brass/20 text-brass",
  confirmed: "bg-green-500/20 text-green-400",
  cancelled: "bg-white/10 text-white/40"
};

onAuthStateChanged(auth, (user) => {
  $("loginView").classList.toggle("hidden", !!user);
  $("dashView").classList.toggle("hidden", !user);
  $("logoutBtn").classList.toggle("hidden", !user);
  if (user) loadBookings();
});

$("loginForm").onsubmit = async (e) => {
  e.preventDefault();
  $("loginError").classList.add("hidden");
  try {
    await signInWithEmailAndPassword(auth, $("email").value.trim(), $("password").value);
  } catch (err) {
    console.error(err);
    $("loginError").classList.remove("hidden");
  }
};
$("logoutBtn").onclick = () => signOut(auth);
$("refreshBtn").onclick = () => loadBookings();
$("filter").onchange = () => render();

async function loadBookings() {
  $("rows").innerHTML = `<tr><td colspan="7" class="p-6 text-center text-white/50">Loading…</td></tr>`;
  try {
    const snap = await getDocs(collection(db, "bookings"));
    bookings = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    render();
  } catch (err) {
    console.error(err);
    $("rows").innerHTML = `<tr><td colspan="7" class="p-6 text-center text-red-400">Could not load bookings. Check Firestore rules.</td></tr>`;
  }
}

function render() {
  const today = new Date().toISOString().slice(0, 10);
  const f = $("filter").value;
  const list = bookings.filter(b =>
    f === "all" ? true : f === "new" ? b.status === "new" : b.date >= today && b.status !== "cancelled");

  ["new", "confirmed", "cancelled"].forEach(s => {
    $("stat" + s[0].toUpperCase() + s.slice(1)).textContent = bookings.filter(b => b.status === s).length;
  });

  if (!list.length) {
    $("rows").innerHTML = `<tr><td colspan="7" class="p-6 text-center text-white/50">No bookings here yet.</td></tr>`;
    return;
  }
  $("rows").innerHTML = list.map(b => `
    <tr class="border-b border-white/5">
      <td class="p-3 whitespace-nowrap">${esc(b.date)}</td>
      <td class="p-3">${esc(b.time)}</td>
      <td class="p-3">${esc(b.name)}</td>
      <td class="p-3 whitespace-nowrap"><a href="tel:${esc(b.phone)}" class="underline">${esc(b.phone)}</a></td>
      <td class="p-3">${esc(b.service)}</td>
      <td class="p-3"><span class="px-2 py-1 rounded text-xs ${STATUS_STYLE[b.status] || ""}">${esc(b.status)}</span></td>
      <td class="p-3 whitespace-nowrap text-right">
        ${b.status === "new" ? `<button data-confirm="${b.id}" class="text-xs bg-green-600 hover:bg-green-500 px-3 py-1 rounded mr-1">Confirm</button>` : ""}
        ${b.status !== "cancelled" ? `<button data-cancel="${b.id}" class="text-xs border border-white/20 hover:bg-white/10 px-3 py-1 rounded">Cancel</button>` : ""}
      </td>
    </tr>`).join("");

  document.querySelectorAll("[data-confirm]").forEach(btn => btn.onclick = async () => {
    await updateDoc(doc(db, "bookings", btn.dataset.confirm), { status: "confirmed" });
    loadBookings();
  });
  document.querySelectorAll("[data-cancel]").forEach(btn => btn.onclick = async () => {
    if (!confirm("Cancel this booking? The time slot will become free again.")) return;
    const b = bookings.find(x => x.id === btn.dataset.cancel);
    await updateDoc(doc(db, "bookings", b.id), { status: "cancelled" });
    await deleteDoc(doc(db, "taken", `${b.date}_${b.time.replace(":", "")}`)).catch(() => {});
    loadBookings();
  });
}
