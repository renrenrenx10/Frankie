
export function createModelSelector(onChange) {
    const selector = document.createElement('select');

    selector.innerHTML = `
        <option value="claude">Claude Mode</option>
        <option value="groq">Groq Mode</option>
        <option value="hybrid" selected>Hybrid Mode</option>
    `;

    selector.addEventListener('change', e => {
        onChange(e.target.value);
    });

    return selector;
}
