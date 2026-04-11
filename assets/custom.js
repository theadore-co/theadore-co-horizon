import { ThemeEvents, VariantUpdateEvent } from '@theme/events';
import { formatMoney } from '@theme/money-formatting';

/**
 * @param {string} formatted
 * @returns {string}
 */
function stripTrailingZeroDecimals(formatted) {
    return formatted.replace('.00', '').replace(',00', '');
}

class ToggleDeposit extends HTMLElement {
    /** @type {HTMLInputElement | null} */
    input = null;

    /**
     * @type {{
     *   id: number;
     *   price?: number;
     *   selling_plan_allocations: { selling_plan_id: number }[];
     * } | null}
     */
    sellingJSON = null;

    /** @type {number | null} */
    selectedVariant = null;

    /** Latest variant price (Shopify cents) for non-TC fallback after option changes. */
    #lastVariantPriceCents = /** @type {number | undefined} */ (undefined);

    connectedCallback() {
        this.selectedVariant = this.dataset.selectedId ? Number(this.dataset.selectedId) : null;

        this.input = this.querySelector('input[type="checkbox"]');

        const jsonEl = this.querySelector('.json-selling');
        if (jsonEl?.textContent) {
            try {
                this.sellingJSON = JSON.parse(jsonEl.textContent);
            } catch (e) {
                console.error('Invalid JSON in .json-selling:', e);
            }
        }

        if (typeof this.sellingJSON?.price === 'number' && Number.isFinite(this.sellingJSON.price)) {
            this.#lastVariantPriceCents = this.sellingJSON.price;
        }

        document.addEventListener('tc:optionschange', this.onTcOptionsChange);

        const closestSection = this.closest('.shopify-section');
        if (closestSection) {
            closestSection.addEventListener(ThemeEvents.variantUpdate, this.updateSellingPlan);
        }

        this.update();
        this.#updatePriceDepositText(this.#lastVariantPriceCents);
        requestAnimationFrame(() => this.#updatePriceDepositText(this.#lastVariantPriceCents));
    }

    disconnectedCallback() {
        document.removeEventListener('tc:optionschange', this.onTcOptionsChange);

        const closestSection = this.closest('.shopify-section, dialog');
        if (closestSection) {
            closestSection.removeEventListener(ThemeEvents.variantUpdate, this.updateSellingPlan);
        }
    }

    /**
     * App dispatches `tc:optionschange` when options change; re-read TC totals and refresh deposit label.
     * Optional `CustomEvent` detail: `{ variantPriceMinor: number }` to refresh fallback base.
     * @param {Event} ev
     */
    onTcOptionsChange = (ev) => {
        const detail = /** @type {CustomEvent<{ variantPriceMinor?: unknown }>} */ (ev).detail;
        if (detail && typeof detail === 'object' && detail !== null) {
            const p = /** @type {{ variantPriceMinor?: unknown }} */ (detail).variantPriceMinor;
            if (typeof p === 'number' && Number.isFinite(p)) {
                this.#lastVariantPriceCents = Math.round(p);
                if (this.input) {
                    this.input.dataset.variantPriceMinor = String(this.#lastVariantPriceCents);
                }
            }
        }

        this.#updatePriceDepositText(this.#lastVariantPriceCents);
        requestAnimationFrame(() => this.#updatePriceDepositText(this.#lastVariantPriceCents));
    };

    /** @returns {string} */
    #getCurrency() {
        const active = /** @type {{ active?: string } | undefined} */ (window.Shopify?.currency)?.active;
        return active || 'USD';
    }

    /** @returns {string} */
    #getMoneyFormatTemplate() {
        const show = this.dataset.showCurrencyCode === 'true';
        const withCur = this.dataset.moneyWithCurrencyFormat;
        const plain = this.dataset.moneyFormat;
        if (show && withCur) return withCur;
        if (plain) return plain;
        return '${{amount}}';
    }

    /**
     * @param {number} minor
     * @returns {string}
     */
    #formatMinor(minor) {
        const formatted = formatMoney(minor, this.#getMoneyFormatTemplate(), this.#getCurrency());
        return stripTrailingZeroDecimals(formatted);
    }

    /**
     * Shopify money: minor units (cents) from third-party pricing.
     * @returns {number | null}
     */
    #getTcTotalWithVariantMinor() {
        try {
            const tc = /** @type {any} */ (window).tc;
            if (!tc || typeof tc.getPricingPlain !== 'function') return null;
            const plain = /** @type {{ minor?: { totalWithVariant?: unknown } } } */ (tc.getPricingPlain());
            const v = plain?.minor?.totalWithVariant;
            if (typeof v !== 'number' || !Number.isFinite(v)) return null;
            return Math.round(v);
        } catch {
            return null;
        }
    }

    /** @param {string | undefined} type */
    #isPercentageCharge(type) {
        return String(type ?? '').toLowerCase() === 'percentage';
    }

    /** @param {string | undefined} type */
    #isPriceCharge(type) {
        return String(type ?? '').toLowerCase() === 'price';
    }

    /**
     * Deposit in cents: % of TC total (rate = whole percent, e.g. 20) or fixed checkout charge.
     * `tcBaseMinor` must already be integer Shopify cents.
     * @param {number} tcBaseMinor
     * @returns {number | null}
     */
    #getDepositMinorFromTcBase(tcBaseMinor) {
        if (!this.input) return null;
        const type = this.input.dataset.chargeType;
        const base = Math.round(tcBaseMinor);
        if (!Number.isFinite(base)) return null;

        if (this.#isPercentageCharge(type)) {
            const rate = Number(this.input.dataset.depositRate);
            if (!Number.isFinite(rate)) return null;
            return Math.round((base * rate) / 100);
        }
        if (this.#isPriceCharge(type)) {
            const fixed = Number(this.input.dataset.depositMinor);
            return Number.isFinite(fixed) ? fixed : null;
        }
        return null;
    }

    /**
     * @param {number | undefined} variantPriceCents
     * @returns {number | null}
     */
    #getDepositMinorForVariant(variantPriceCents) {
        if (!this.input) return null;
        const type = this.input.dataset.chargeType;
        const baseMinor =
            typeof variantPriceCents === 'number' && Number.isFinite(variantPriceCents)
                ? variantPriceCents
                : Number(this.input.dataset.variantPriceMinor);

        if (this.#isPercentageCharge(type)) {
            const rate = Number(this.input.dataset.depositRate);
            if (!Number.isFinite(rate) || !Number.isFinite(baseMinor)) return null;
            return Math.round((baseMinor * rate) / 100);
        }
        if (this.#isPriceCharge(type)) {
            const fixed = Number(this.input.dataset.depositMinor);
            return Number.isFinite(fixed) ? fixed : null;
        }
        return null;
    }

    /**
     * `.price-deposit-text`: formatted deposit only. With TC + percentage = rate% of
     * `minor.totalWithVariant` (Shopify cents), not variant list price. No toggle dependency.
     * @param {number | undefined} variantPriceCents
     */
    #updatePriceDepositText(variantPriceCents) {
        const el = this.querySelector('.price-deposit-text');
        if (!el || !this.input) return;

        const tcCents = this.#getTcTotalWithVariantMinor();
        let depositMinor = null;

        if (tcCents != null) {
            depositMinor = this.#getDepositMinorFromTcBase(tcCents);
        }

        if (depositMinor == null) {
            depositMinor = this.#getDepositMinorForVariant(variantPriceCents);
        }

        if (depositMinor == null) {
            el.textContent = '';
            return;
        }

        el.textContent = this.#formatMinor(depositMinor);
    }

    update() {
        if (!this.sellingJSON) return;
        if (!this.selectedVariant) return;

        if (this.sellingJSON.id !== this.selectedVariant) return;
        if (!this.sellingJSON.selling_plan_allocations?.[0]) return;
        if (!this.input) return;

        const planId = this.sellingJSON.selling_plan_allocations[0].selling_plan_id;
        this.input.value = planId.toString();

        if (typeof this.sellingJSON.price === 'number' && Number.isFinite(this.sellingJSON.price)) {
            this.#lastVariantPriceCents = Math.round(this.sellingJSON.price);
        }
        this.#updatePriceDepositText(this.#lastVariantPriceCents);
    }

    /**
     * @param {VariantUpdateEvent} event
     */
    updateSellingPlan = (event) => {
        const resource = /** @type {any} */ (event.detail.resource);
        if (resource?.id) {
            this.dataset.selectedId = String(resource.id);
            this.selectedVariant = Number(resource.id);
        }

        const sellingPlanAllocations = resource?.selling_plan_allocations;
        if (!this.input) return;
        if (!sellingPlanAllocations?.[0]) return;

        this.input.value = String(sellingPlanAllocations[0].selling_plan_id);

        const cents = typeof resource?.price === 'number' ? resource.price : undefined;
        if (typeof resource?.price === 'number' && Number.isFinite(resource.price)) {
            this.#lastVariantPriceCents = Math.round(resource.price);
            this.input.dataset.variantPriceMinor = String(this.#lastVariantPriceCents);
        }
        this.#updatePriceDepositText(this.#lastVariantPriceCents);
        requestAnimationFrame(() => this.#updatePriceDepositText(this.#lastVariantPriceCents));
    };
}

if (!customElements.get('toggle-deposit')) {
    customElements.define('toggle-deposit', ToggleDeposit);
}

function scrollToHash() {
    const hash = window.location.hash;
    if (hash) {
        const id = hash.slice(1);
        const target = document.querySelector(`[data-section-id="${id}"]`);
        if (target) {
            let offset = 0;
            const stickyHeader = document.querySelector('.header[data-sticky-state="active"]');
            if (stickyHeader) {
                offset = stickyHeader.clientHeight;
            }

            const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - offset;

            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth',
            });
        }
    }
}

scrollToHash();
window.addEventListener('hashchange', scrollToHash);
