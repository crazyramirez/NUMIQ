<template>
  <div class="auth">
    <section class="form-side">
      <header class="brand-row">
        <AppLogo :size="30" />
      </header>
      <div class="form-wrap">
        <slot />
      </div>
      <footer class="legal">© {{ new Date().getFullYear() }} NUMIQ · Hecho para autónomos y pymes en España</footer>
    </section>

    <aside class="showcase" aria-hidden="true">
      <div class="glow" />
      <div class="grid-bg" />
      <div class="show-inner">
        <p class="kicker"><Icon name="ph:sparkle-fill" /> Tu negocio, en piloto automático</p>
        <h2>Factura, controla gastos y cumple con Hacienda sin pensar en ello.</h2>

        <div class="mock">
          <div class="mock-card main">
            <div class="row between">
              <span class="m-label">Beneficio este trimestre</span>
              <span class="m-pill">+18 %</span>
            </div>
            <p class="m-value num">14.862,40 €</p>
            <svg viewBox="0 0 300 70" class="m-chart" preserveAspectRatio="none">
              <defs>
                <linearGradient id="mg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="#818cf8" stop-opacity="0.45" />
                  <stop offset="1" stop-color="#818cf8" stop-opacity="0" />
                </linearGradient>
              </defs>
              <path d="M0 55 C30 50 45 58 70 44 S110 30 140 36 S190 18 215 22 S265 8 300 6 V70 H0Z" fill="url(#mg)" />
              <path d="M0 55 C30 50 45 58 70 44 S110 30 140 36 S190 18 215 22 S265 8 300 6" fill="none" stroke="#a5b4fc" stroke-width="2.2" />
            </svg>
          </div>
          <div class="mock-card float-a">
            <span class="dot ok"><Icon name="ph:check-bold" /></span>
            <div>
              <p class="f-t">F2026-0142 cobrada</p>
              <p class="f-s num">2.420,00 € · Lumen Arquitectura</p>
            </div>
          </div>
          <div class="mock-card float-b">
            <span class="dot ai"><Icon name="ph:sparkle-fill" /></span>
            <div>
              <p class="f-t">Aparta 2.180 € para el 4T</p>
              <p class="f-s">IVA (303) + IRPF (130) estimados</p>
            </div>
          </div>
        </div>

        <ul class="points">
          <li><Icon name="ph:seal-check-fill" /> Facturas y presupuestos profesionales con tu marca</li>
          <li><Icon name="ph:scan-fill" /> Escanea tickets y facturas: la IA rellena el resto</li>
          <li><Icon name="ph:bank-fill" /> Modelos 303, 130, 111 y 115 calculados solos</li>
        </ul>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.auth {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
  min-height: 100dvh;
  background: var(--surface);
}

.form-side {
  display: flex;
  flex-direction: column;
  padding: var(--s-7) var(--s-9);
}

.form-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  width: 100%;
  max-width: 400px;
  margin: 0 auto;
  padding: var(--s-8) 0;
}

.legal {
  font-size: var(--text-xs);
  color: var(--text-4);
}

.showcase {
  position: relative;
  overflow: hidden;
  margin: 12px;
  border-radius: 28px;
  background: #0b0c1a;
  color: #fff;
}

.glow {
  position: absolute;
  inset: -20%;
  background:
    radial-gradient(40% 35% at 75% 20%, rgb(124 58 237 / 0.55), transparent 70%),
    radial-gradient(45% 40% at 20% 85%, rgb(14 165 233 / 0.35), transparent 70%),
    radial-gradient(50% 50% at 50% 50%, rgb(79 70 229 / 0.4), transparent 75%);
  filter: blur(10px);
}

.grid-bg {
  position: absolute;
  inset: 0;
  background-image: linear-gradient(rgb(255 255 255 / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(255 255 255 / 0.05) 1px, transparent 1px);
  background-size: 44px 44px;
  mask-image: radial-gradient(70% 60% at 50% 40%, black, transparent);
}

.show-inner {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  height: 100%;
  padding: var(--s-9) var(--s-9);
}

.kicker {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-sm);
  font-weight: 600;
  color: #c4b5fd;
}

h2 {
  max-width: 520px;
  margin-top: var(--s-4);
  font-size: clamp(1.75rem, 2.6vw, 2.5rem);
  font-weight: 680;
  letter-spacing: -0.03em;
  line-height: 1.12;
}

.mock {
  position: relative;
  max-width: 470px;
  margin: var(--s-8) 0 var(--s-8);
}

.mock-card {
  border-radius: 18px;
  background: rgb(255 255 255 / 0.07);
  border: 1px solid rgb(255 255 255 / 0.12);
  backdrop-filter: blur(16px);
  box-shadow: 0 20px 50px -20px rgb(0 0 0 / 0.6);
}

.main {
  padding: 20px 22px 0;
}

.m-label {
  font-size: var(--text-sm);
  color: rgb(255 255 255 / 0.65);
}

.m-pill {
  padding: 2px 8px;
  font-size: var(--text-xs);
  font-weight: 650;
  color: #6ee7b7;
  background: rgb(16 185 129 / 0.16);
  border-radius: 99px;
}

.m-value {
  margin-top: 6px;
  font-size: 32px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.m-chart {
  width: 100%;
  height: 80px;
  margin-top: 6px;
}

.float-a,
.float-b {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px 12px 12px;
  background: rgb(20 22 40 / 0.78);
  animation: rise 700ms var(--ease-out) both;
}

.float-a {
  right: -36px;
  top: -26px;
  animation-delay: 200ms;
}

.float-b {
  left: -28px;
  bottom: -30px;
  animation-delay: 380ms;
}

.dot {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 10px;
  font-size: 15px;
}

.dot.ok {
  color: #6ee7b7;
  background: rgb(16 185 129 / 0.18);
}

.dot.ai {
  background: linear-gradient(120deg, #7c3aed, #4f46e5, #0ea5e9);
}

.f-t {
  font-size: var(--text-sm);
  font-weight: 620;
}

.f-s {
  font-size: var(--text-xs);
  color: rgb(255 255 255 / 0.6);
}

.points {
  display: grid;
  gap: 12px;
  margin-top: var(--s-6);
  list-style: none;
  padding: 0;
  color: rgb(255 255 255 / 0.82);
}

.points li {
  display: flex;
  align-items: center;
  gap: 10px;
}

.points :deep(svg) {
  width: 18px;
  height: 18px;
  color: #a5b4fc;
}

@media (max-width: 1023px) {
  .auth {
    grid-template-columns: minmax(0, 1fr);
  }

  .showcase {
    display: none;
  }

  .form-side {
    padding: var(--s-6) var(--s-5);
  }
}
</style>
