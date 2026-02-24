/**
 * Tooltip management for annotation comments.
 * Creates/positions a floating tooltip near hovered text.
 */

let activeTooltip: HTMLElement | null = null;

export function showTooltip(comment: string, rect: DOMRect, container: HTMLElement): void {
    hideTooltip();

    const tooltip = document.createElement('div');
    tooltip.className = 'annotation-tooltip';
    tooltip.textContent = comment;

    // Position below the highlighted text
    tooltip.style.position = 'fixed';
    tooltip.style.left = `${rect.left}px`;
    tooltip.style.top = `${rect.bottom + 6}px`;
    tooltip.style.zIndex = '9999';

    container.appendChild(tooltip);
    activeTooltip = tooltip;

    // Adjust if tooltip goes off-screen to the right
    requestAnimationFrame(() => {
        if (!activeTooltip) return;
        const tooltipRect = activeTooltip.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        if (tooltipRect.right > viewportWidth - 10) {
            activeTooltip.style.left = `${viewportWidth - tooltipRect.width - 10}px`;
        }
        // If below viewport, show above
        const viewportHeight = window.innerHeight;
        if (tooltipRect.bottom > viewportHeight - 10) {
            activeTooltip.style.top = `${rect.top - tooltipRect.height - 6}px`;
        }
    });
}

export function hideTooltip(): void {
    if (activeTooltip) {
        activeTooltip.remove();
        activeTooltip = null;
    }
}
