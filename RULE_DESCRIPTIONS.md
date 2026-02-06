# Rule Descriptions Implementation

## ✅ Feature Added: Rule Descriptions

Each renaming rule now displays a helpful description underneath the rule type to explain what it does.

### Visual Layout

```
┌──────────────────────────────────────────────────────────────┐
│ 1.  Replace                                    [Find] [Replace] │
│     Find and replace text in filenames              [×]        │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ 2.  Prefix                                     [Text input]    │
│     Add text at the beginning of filenames          [×]        │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ 3.  Pattern                                [Pattern input]     │
│     Use variables to build dynamic filenames        [×]        │
│     Available variables: {name} {index} {ext} ...              │
└──────────────────────────────────────────────────────────────┘
```

### Rule Descriptions

| Rule Type | Description (EN) | Description (FR) | Description (ES) |
|-----------|-----------------|------------------|------------------|
| **Replace** | Find and replace text in filenames | Rechercher et remplacer du texte dans les noms | Buscar y reemplazar texto en nombres |
| **Prefix** | Add text at the beginning of filenames | Ajouter du texte au début des noms | Añadir texto al principio de los nombres |
| **Suffix** | Add text at the end (before extension) | Ajouter du texte à la fin (avant l'extension) | Añadir texto al final (antes de la extensión) |
| **Numbering** | Add sequential numbers to filenames | Ajouter des numéros séquentiels aux noms | Añadir números secuenciales a los nombres |
| **Lowercase** | Convert all characters to lowercase | Convertir tous les caractères en minuscules | Convertir todos los caracteres a minúsculas |
| **Remove Special** | Remove special characters (keep letters, numbers, - and _) | Supprimer caractères spéciaux (garder lettres, chiffres, - et _) | Eliminar caracteres especiales (mantener letras, números, - y _) |
| **Pattern** | Use variables to build dynamic filenames | Utiliser des variables pour créer des noms dynamiques | Usar variables para crear nombres dinámicos |

## Implementation Details

### 1. Translation Keys Added
All three locale files (`en.json`, `fr.json`, `es.json`) now include:
```json
{
  "rule_replace_desc": "...",
  "rule_prefix_desc": "...",
  "rule_suffix_desc": "...",
  "rule_numbering_desc": "...",
  "rule_lowercase_desc": "...",
  "rule_remove_special_desc": "...",
  "rule_pattern_desc": "..."
}
```

### 2. Helper Function (app.js)
```javascript
getRuleDescription(ruleType) {
    const descMap = {
        'replace': 'rule_replace_desc',
        'prefix': 'rule_prefix_desc',
        'suffix': 'rule_suffix_desc',
        'numbering': 'rule_numbering_desc',
        'lowercase': 'rule_lowercase_desc',
        'remove_special': 'rule_remove_special_desc',
        'pattern': 'rule_pattern_desc'
    };
    return this.t(descMap[ruleType] || '');
}
```

### 3. Updated HTML Structure (config.html)
```html
<!-- Rule Type with Description -->
<div class="flex flex-col w-48 sm:w-56">
    <div class="font-medium text-gray-700 dark:text-white capitalize">
        <span x-text="rule.type.replace('_', ' ')"></span>
    </div>
    <div class="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-tight">
        <span x-text="getRuleDescription(rule.type)"></span>
    </div>
</div>
```

## Benefits

1. **Better UX**: Users immediately understand what each rule does without trial and error
2. **Reduced Support**: Clear descriptions reduce confusion and support questions
3. **Multilingual**: Descriptions translate automatically with language switcher
4. **Dark Mode**: Descriptions are fully styled for both light and dark themes
5. **Responsive**: Layout adjusts properly on mobile devices

## Testing Checklist

- [ ] All 7 rule types show descriptions
- [ ] Descriptions are visible in light mode
- [ ] Descriptions are visible in dark mode
- [ ] English descriptions display correctly
- [ ] French descriptions display correctly
- [ ] Spanish descriptions display correctly
- [ ] Mobile layout looks good
- [ ] Descriptions don't break rule card layout

## Files Modified

1. **`public/locales/en.json`** - Added 7 English descriptions
2. **`public/locales/fr.json`** - Added 7 French descriptions
3. **`public/locales/es.json`** - Added 7 Spanish descriptions
4. **`public/js/app.js`** - Added `getRuleDescription()` helper function
5. **`public/config.html`** - Updated rule card layout to show descriptions
