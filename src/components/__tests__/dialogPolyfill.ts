/** jsdom has no <dialog>.showModal(); fake just enough for ModalDialog to open and close. */
export function installDialogPolyfill(): void {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
}
