import { buffer } from "../lib/decorator/buffer";
import { RunOnce } from "../lib/decorator/run-once";
import { RollData, UtilsRoll } from "../lib/roll/utils-roll";
import { MemoryStorageService, MemoryValue } from "../service/memory-storage-service";
import { staticValues } from "../static-values";
import { UtilsElement } from "./utils-element";

export class RollResultElement extends HTMLElement {

  public static selector(): string {
    return `${staticValues.code}-roll-result`;
  }

  @RunOnce()
  public static registerHooks(): void {
    customElements.define(RollResultElement.selector(), RollResultElement);
  }
  
  public static get observedAttributes() {
    return [
      // Required
      'data-roll',
      // Optional
      'data-compact',
      'data-highlight-total-on-firstTerm',
      'data-override-formula',
      'data-override-max-roll',
    ];
  }

  private unregister: ReturnType<MemoryValue['listen']>;
  private elementsBySlotName: Map<string, Element[]> = new Map();
  public connectedCallback(): void {
    this.addEventListener('click', () => this.toggleOpen());
    this.unregister = MemoryStorageService.getElementValue(this, 'roll-open').listen(value => this.setOpenState(!!value));

    const elementsBySlotName = new Map<string, Element[]>();
    this.querySelectorAll('[slot]').forEach(element => {
      if (!elementsBySlotName.has(element.getAttribute('slot'))) {
        elementsBySlotName.set(element.getAttribute('slot'), []);
      }
      elementsBySlotName.get(element.getAttribute('slot')).push(element);
    });
    this.elementsBySlotName = elementsBySlotName;
    this.textContent = '';
    this.calcInner();
  }

  @buffer()
  public attributeChangedCallback(args: Array<[string/* attributeName */, string/* oldValue */, string/* newValue */]>): void {
    this.calcInner();
  }

  public disconnectedCallback(): void {
    if (this.unregister) {
      this.unregister.unregister();
    }
  }

  private async calcInner(): Promise<void> {
    const rollJson: RollData = UtilsElement.readAttrJson(this, 'data-roll');
    if (!rollJson?.evaluated) {
      this.textContent = '';
      return;
    }
    const html = await renderTemplate(
      `modules/${staticValues.moduleName}/templates/roll/roll.hbs`, {
        roll: UtilsRoll.fromRollData(rollJson),
        overrideFormula: UtilsElement.readAttrString(this, 'data-override-formula'),
        highlightTotalOnFirstTerm: UtilsElement.readAttrBoolean(this, 'data-highlight-total-on-firstTerm'),
        overrideMaxRoll: UtilsElement.readAttrInteger(this, 'data-override-max-roll'),
      }
    );

    const root = document.createElement('div');
    root.innerHTML = html;
    for (const slotName of this.elementsBySlotName.keys()) {
      const replaceElements = this.elementsBySlotName.get(slotName);
      const slots = root.querySelectorAll(`slot[name="${slotName}"]`);
      slots.forEach(slot => {
        for (let i = replaceElements.length - 1; i >= 0; i--) {
          slot.parentNode.insertBefore(replaceElements[i].cloneNode(true), slot);
        }
      });
      slots.forEach(slot => {
        slot.parentNode.removeChild(slot);
      });
    }
    this.textContent = '';
    this.append(...Array.from(root.childNodes));
    this.setOpenState(!!MemoryStorageService.getElementValue(this, 'roll-open').get());
  }

  private toggleOpen(): void {
    const value = MemoryStorageService.getElementValue(this, 'roll-open');
    value.set(!value.get());
  }

  private setOpenState(shouldBeOpen: boolean): void {
    const wrapper = this.querySelector(':scope > .wrapper');
    if (!wrapper) {
      return;
    }
    
    const isCurrentlyOpen = wrapper.classList.contains('open');
    if (isCurrentlyOpen != shouldBeOpen) {
      if (shouldBeOpen) {
        wrapper.classList.add('open');
      } else {
        wrapper.classList.remove('open');
      }
    }
  }

}