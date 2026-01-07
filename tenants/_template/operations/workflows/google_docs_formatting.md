# Google Docs Formatting Guide

When creating Google Docs, ALWAYS follow this two-step process for professional results.

## Step 1: Create the Document

Use `mcp__tools__drive_create_doc` with plain text content:

```json
{
  "title": "Document Title",
  "content": "Your content here with line breaks for structure..."
}
```

**Save the returned `file.id`** - you need it for Step 2.

## Step 2: Apply Formatting

Use `mcp__tools__docs_format` with the doc_id and operations array.

### Formatting Operations Reference

#### Headings (paragraph_style with named_style_type)

| Style | Use For |
|-------|---------|
| `TITLE` | Document title (largest) |
| `HEADING_1` | Main sections |
| `HEADING_2` | Subsections |
| `HEADING_3` | Sub-subsections |
| `NORMAL_TEXT` | Body paragraphs |

Example:
```json
{"type": "paragraph_style", "match": "Section Title", "named_style_type": "HEADING_2"}
```

#### Text Styles (style_text)

```json
{"type": "style_text", "match": "text to bold", "bold": true}
{"type": "style_text", "match": "text to italicize", "italic": true}
{"type": "style_text", "match": "text to resize", "font_size_pt": 14}
{"type": "style_text", "match": "colored text", "color_rgb": [255, 0, 0]}
```

#### Alignment (paragraph_style with alignment)

```json
{"type": "paragraph_style", "match": "text to center", "alignment": "CENTER"}
```

Options: `START`, `CENTER`, `END`, `JUSTIFIED`

#### Bullet Lists

```json
{"type": "bullets", "match": "• Item 1\n• Item 2\n• Item 3", "preset": "BULLET_DISC_CIRCLE_SQUARE"}
```

## Complete Example

**Creating meeting notes:**

Step 1 - Create:
```json
{
  "title": "Meeting Notes - Jan 7",
  "content": "Meeting Notes - Jan 7\n\nAttendees\nJohn, Jane, Bob\n\nDiscussion\nProject is on track.\n\nAction Items\n• John: Testing\n• Jane: Demo\n• Bob: Report"
}
```

Step 2 - Format (use returned doc_id):
```json
{
  "doc_id": "DOC_ID_HERE",
  "operations": [
    {"type": "paragraph_style", "match": "Meeting Notes - Jan 7", "named_style_type": "TITLE"},
    {"type": "paragraph_style", "match": "Meeting Notes - Jan 7", "alignment": "CENTER"},
    {"type": "paragraph_style", "match": "Attendees", "named_style_type": "HEADING_2"},
    {"type": "paragraph_style", "match": "Discussion", "named_style_type": "HEADING_2"},
    {"type": "paragraph_style", "match": "Action Items", "named_style_type": "HEADING_2"},
    {"type": "bullets", "match": "• John: Testing\n• Jane: Demo\n• Bob: Report"},
    {"type": "style_text", "match": "John:", "bold": true},
    {"type": "style_text", "match": "Jane:", "bold": true},
    {"type": "style_text", "match": "Bob:", "bold": true}
  ]
}
```

## Tips

1. **Always format after creation** - Plain text first, styles second
2. **Use semantic headings** - TITLE > HEADING_1 > HEADING_2 > HEADING_3
3. **Match exact text** - The `match` parameter must match content exactly
4. **Batch operations** - Send all formatting in one `docs_format` call
5. **Use bullets with •** - Include bullet character in content, then apply bullets style
