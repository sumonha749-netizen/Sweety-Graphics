"use strict";

const CART_KEY = "sweety_cart_v1";

let products = [];
let deliveryCharge = 0;
let cart = loadCart();

function loadCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(CART_KEY) || "[]");

    if (!Array.isArray(stored)) return [];

    return stored.filter(item =>
      item &&
      Number.isSafeInteger(item.id) &&
      item.id > 0 &&
      Number.isSafeInteger(item.quantity) &&
      item.quantity >= 1 &&
      item.quantity <= 20
    );
  } catch {
    return [];
  }
}

function saveCart() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch {
    document.getElementById("message").textContent =
      "ব্রাউজারে কার্ট সংরক্ষণ করা যাচ্ছে না।";
  }
}

async function loadProducts() {
  const loading = document.getElementById("loading");

  try {
    const response = await fetch("/api/products");

    if (!response.ok) {
      throw new Error("Could not load products");
    }

    const data = await response.json();

    products = data.products;
    deliveryCharge = data.deliveryCharge;

    loading.textContent = products.length
      ? ""
      : "কোনো পণ্য পাওয়া যায়নি।";

    renderProducts();
    renderCart();
  } catch {
    loading.textContent =
      "পণ্য লোড হয়নি। পেজ রিফ্রেশ করে চেষ্টা করুন।";
  }
}

function renderProducts() {
  const list = document.getElementById("productList");
  list.replaceChildren();

  for (const product of products) {
    const card = document.createElement("article");
    card.className = "card";

    if (
      product.image_url &&
      /^https:\/\//i.test(product.image_url)
    ) {
      const image = document.createElement("img");
      image.src = product.image_url;
      image.alt = product.name;
      card.appendChild(image);
    } else {
      const placeholder = document.createElement("div");
      placeholder.className = "placeholder";
      placeholder.textContent = "পণ্যের ছবি";
      card.appendChild(placeholder);
    }

    const title = document.createElement("h3");
    title.textContent = product.name;

    const color = document.createElement("p");
    color.textContent = "রঙ: " + product.color;

    const stock = document.createElement("p");
    stock.textContent = "স্টক: " + product.stock;

    const price = document.createElement("p");
    price.className = "price";
    price.textContent = "৳ " + product.price;

    const button = document.createElement("button");
    button.type = "button";
    button.disabled = product.stock < 1;

    button.textContent = product.stock > 0
      ? "কার্টে যোগ করুন"
      : "স্টক নেই";

    button.addEventListener("click", () => {
      addToCart(product.id);
    });

    card.append(title, color, stock, price, button);
    list.appendChild(card);
  }
}

function addToCart(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;

  const current = cart.find(item => item.id === id);
  const quantity = current ? current.quantity : 0;

  if (quantity >= product.stock || quantity >= 20) {
    alert("আর বেশি যোগ করা যাচ্ছে না।");
    return;
  }

  if (current) {
    current.quantity += 1;
  } else {
    cart.push({ id, quantity: 1 });
  }

  saveCart();
  renderCart();
}

function removeFromCart(id) {
  cart = cart.filter(item => item.id !== id);
  saveCart();
  renderCart();
}

function renderCart() {
  const container = document.getElementById("cartItems");
  container.replaceChildren();

  let subtotal = 0;
  let count = 0;

  if (!cart.length) {
    container.textContent = "কার্ট খালি।";
  }

  for (const item of cart) {
    const product = products.find(p => p.id === item.id);

    const row = document.createElement("div");
    row.className = "cart-row";

    const text = document.createElement("span");

    if (product) {
      const lineTotal = product.price * item.quantity;

      subtotal += lineTotal;
      count += item.quantity;

      text.textContent =
        `${product.name} × ${item.quantity} — ৳ ${lineTotal}`;
    } else {
      text.textContent =
        `পণ্য #${item.id} পাওয়া যায়নি।`;
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "মুছুন";

    remove.addEventListener("click", () => {
      removeFromCart(item.id);
    });

    row.append(text, remove);
    container.appendChild(row);
  }

  document.getElementById("count").textContent = count;

  document.getElementById("totals").textContent = cart.length
    ? `পণ্য: ৳ ${subtotal} + ডেলিভারি: ৳ ${deliveryCharge} = মোট: ৳ ${subtotal + deliveryCharge}`
    : "";
}

document.getElementById("orderForm").addEventListener(
  "submit",
  async event => {
    event.preventDefault();

    const message = document.getElementById("message");
    const button = document.getElementById("orderButton");
    const link = document.getElementById("whatsappLink");

    link.classList.add("hidden");
    message.textContent = "";

    if (!cart.length) {
      message.textContent = "প্রথমে কার্টে পণ্য যোগ করুন।";
      return;
    }

    const body = {
      name: document.getElementById("name").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      address: document.getElementById("address").value.trim(),
      payment: document.getElementById("payment").value,
      items: cart.map(item => ({
        id: item.id,
        quantity: item.quantity
      }))
    };

    button.disabled = true;
    message.textContent = "অর্ডার সংরক্ষণ হচ্ছে...";

    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        message.textContent =
          data.error || "অর্ডার করা যায়নি।";

        await loadProducts();
        return;
      }

      cart = [];
      saveCart();

      document.getElementById("orderForm").reset();

      message.textContent =
        `অর্ডার #${data.orderId} সংরক্ষিত হয়েছে। মোট: ৳ ${data.total}।`;

      if (data.whatsappLink) {
        link.href = data.whatsappLink;
        link.classList.remove("hidden");
      }

      await loadProducts();
    } catch {
      message.textContent =
        "সার্ভারের উত্তর পাওয়া যায়নি। অর্ডারটি সংরক্ষিত হয়ে থাকতে পারে; আবার চাপার আগে দোকানের সঙ্গে যোগাযোগ করুন।";
    } finally {
      button.disabled = false;
    }
  }
);

loadProducts();
