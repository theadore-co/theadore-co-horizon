import { ThemeEvents, VariantUpdateEvent } from '@theme/events';

class ToggleDeposit extends HTMLElement {
    /** @type {HTMLInputElement | null} */
    input = null;

    /** 
     * @type {{
     *   id: number;
     *   selling_plan_allocations: { selling_plan_id: number }[];
     * } | null}
     */
    sellingJSON = null;

    /** @type {number | null} */
    selectedVariant = null;

    connectedCallback() {
        // Safely read data attribute
        this.selectedVariant = this.dataset.selectedId
        ? Number(this.dataset.selectedId)
        : null;

        // Safely query inside the component
        this.input = this.querySelector('input[type="checkbox"]');

        // Safely query JSON outside
        const jsonEl = document.querySelector('.json-selling');
        if (jsonEl?.textContent) {
            try {
                this.sellingJSON = JSON.parse(jsonEl.textContent);
            } catch (e) {
                console.error('Invalid JSON in .json-selling:', e);
            }
        }

        const closestSection = this.closest('.shopify-section');
        if (!closestSection) return;
        closestSection.addEventListener(
        ThemeEvents.variantUpdate,
        this.updateSellingPlan
        );

        this.update()
    }

    disconnectedCallback() {
        const closestSection = this.closest('.shopify-section, dialog');
        if (!closestSection) return;
        closestSection.removeEventListener(
        ThemeEvents.variantUpdate,
        this.updateSellingPlan
        );
    }

    update() {
        if (!this.sellingJSON) return;
        if (!this.selectedVariant) return;

        // Compare the single object's id
        if (this.sellingJSON.id !== this.selectedVariant) return;
        if (!this.sellingJSON.selling_plan_allocations?.[0]) return;
        if (!this.input) return;

        const planId = this.sellingJSON.selling_plan_allocations[0].selling_plan_id;

        console.log('sellingFound plan ID:', planId);

        // Convert number → string before assigning
        this.input.value = planId.toString();
    }

    /**
     * Updates the price.
     * @param {VariantUpdateEvent} event
     */
    updateSellingPlan = (event) => {
        const sellingPlanAllocations = /** @type {any} */ (
            event.detail.resource
        )['selling_plan_allocations'];


        if (!this.input) return;
        if (!sellingPlanAllocations?.[0]) return;

        this.input.value = sellingPlanAllocations[0].selling_plan_id;
    };

}

if (!customElements.get('toggle-deposit')) {
  customElements.define('toggle-deposit', ToggleDeposit);
}

function scrollToHash() {
  const hash = window.location.hash; // "#faq"
  if (hash) {
    const id = hash.slice(1); // remove #
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
        behavior: "smooth"
      });
    }
  }
}

// Run on page load
scrollToHash();

// Run on hash change
window.addEventListener("hashchange", scrollToHash);