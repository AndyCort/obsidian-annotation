/**
 * Tooltip management for annotation comments.
 * Creates/positions a floating tooltip near hovered text.
 */

let activeTooltip: HTMLElement | null = null;
let isEditing = false;

interface TooltipOptions {
    comment: string;
    rect: DOMRect;
    container: HTMLElement;
    onSave?: (newComment: string) => void;
}

export function showTooltip({ comment, rect, container, onSave }: TooltipOptions): void {
    // Don't close or update if we're currently editing
    if (isEditing) return;

    hideTooltip();

    const tooltip = document.createElement('div');
    tooltip.className = 'annotation-tooltip';

    // Display mode container
    const displayContainer = document.createElement('div');
    displayContainer.className = 'annotation-tooltip-display';
    displayContainer.textContent = comment;

    tooltip.appendChild(displayContainer);

    // Position below the highlighted text
    tooltip.style.position = 'fixed';
    tooltip.style.left = `${rect.left}px`;
    tooltip.style.top = `${rect.bottom + 6}px`;
    tooltip.style.zIndex = '9999';

    // If a save callback is provided, enable editing
    if (onSave) {
        tooltip.classList.add('is-editable');
        tooltip.title = 'Click to edit';

        displayContainer.addEventListener('click', (e) => {
            e.stopPropagation();
            enterEditMode(tooltip, displayContainer, comment, onSave);
        });
    }

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

function enterEditMode(
    tooltip: HTMLElement,
    displayContainer: HTMLElement,
    initialComment: string,
    onSave: (newComment: string) => void
) {
    isEditing = true;
    tooltip.title = '';
    displayContainer.style.display = 'none';

    const input = document.createElement('textarea');
    input.className = 'annotation-tooltip-input';
    input.value = initialComment;
    input.rows = 2;

    tooltip.appendChild(input);
    input.focus();

    // Move cursor to end
    input.setSelectionRange(input.value.length, input.value.length);

    const saveChanges = () => {
        const newVal = input.value.trim();
        if (newVal && newVal !== initialComment) {
            onSave(newVal);
            displayContainer.textContent = newVal;
        } else {
            displayContainer.textContent = initialComment;
        }
        cleanupEdit();
    };

    const cleanupEdit = () => {
        input.remove();
        displayContainer.style.display = 'block';
        isEditing = false;
    };

    input.addEventListener('blur', saveChanges);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            saveChanges();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cleanupEdit();
        }
    });
}

export function hideTooltip(): void {
    if (isEditing) return; // Prevent hiding if user is typing
    if (activeTooltip) {
        activeTooltip.remove();
        activeTooltip = null;
    }
}
