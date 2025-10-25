/**
 * Small DOM utility helpers used by input pads
 */
export function getOffset(el) {
    if (!el || !el.getBoundingClientRect) return { left: 0, top: 0 };
    const r = el.getBoundingClientRect();
    return { left: r.left + window.scrollX, top: r.top + window.scrollY };
}

export default { getOffset };
