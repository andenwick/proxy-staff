#!/usr/bin/env python3
"""
life_schemas.py - JSON Schema definitions for life system files.

Each life file uses JSON frontmatter format:
---json
{ ... structured data ... }
---
# Markdown content below...
"""

# Schema version - increment when making breaking changes
SCHEMA_VERSION = 1

IDENTITY_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "default": SCHEMA_VERSION},
        "lastUpdated": {"type": "string", "format": "date-time"},
        "name": {"type": "string"},
        "timezone": {"type": "string"},
        "preferences": {
            "type": "object",
            "properties": {
                "communicationStyle": {
                    "type": "string",
                    "enum": ["concise", "detailed", "casual", "formal"]
                },
                "responseLength": {
                    "type": "string",
                    "enum": ["short", "medium", "long"]
                },
                "workingHours": {
                    "type": "object",
                    "properties": {
                        "start": {"type": "string"},
                        "end": {"type": "string"},
                        "days": {
                            "type": "array",
                            "items": {"type": "integer", "minimum": 0, "maximum": 6}
                        }
                    }
                }
            }
        }
    },
    "required": ["version"]
}

BOUNDARIES_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "default": SCHEMA_VERSION},
        "lastUpdated": {"type": "string", "format": "date-time"},
        "neverDo": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Actions to never take"
        },
        "alwaysDo": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Actions to always take"
        },
        "escalateWhen": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Conditions requiring escalation"
        },
        "limits": {
            "type": "object",
            "properties": {
                "maxResponseChars": {"type": "integer"},
                "maxSpendWithoutConfirmation": {"type": "number"},
                "allowedDomains": {
                    "type": "array",
                    "items": {"type": "string"}
                }
            }
        }
    },
    "required": ["version"]
}

PATTERN_ENTRY_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "pattern": {"type": "string"},
        "confidence": {
            "type": "string",
            "enum": ["low", "medium", "high"]
        },
        "observedAt": {"type": "string", "format": "date-time"},
        "examples": {
            "type": "array",
            "items": {"type": "string"}
        }
    },
    "required": ["id", "pattern", "confidence"]
}

PATTERNS_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "default": SCHEMA_VERSION},
        "lastUpdated": {"type": "string", "format": "date-time"},
        "lastAnalyzed": {"type": "string", "format": "date-time"},
        "communication": {
            "type": "array",
            "items": PATTERN_ENTRY_SCHEMA
        },
        "work": {
            "type": "array",
            "items": PATTERN_ENTRY_SCHEMA
        },
        "temporal": {
            "type": "array",
            "items": PATTERN_ENTRY_SCHEMA
        }
    },
    "required": ["version"]
}

CONTACT_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "name": {"type": "string"},
        "role": {"type": "string"},
        "organization": {"type": "string"},
        "email": {"type": "string", "format": "email"},
        "phone": {"type": "string"},
        "notes": {"type": "string"},
        "lastMentioned": {"type": "string", "format": "date-time"}
    },
    "required": ["id", "name"]
}

CONTACTS_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "default": SCHEMA_VERSION},
        "lastUpdated": {"type": "string", "format": "date-time"},
        "contacts": {
            "type": "array",
            "items": CONTACT_SCHEMA
        }
    },
    "required": ["version"]
}

KNOWLEDGE_ENTRY_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "fact": {"type": "string"},
        "source": {
            "type": "string",
            "enum": ["stated", "inferred", "observed"]
        },
        "learnedAt": {"type": "string", "format": "date-time"},
        "confidence": {
            "type": "string",
            "enum": ["low", "medium", "high"]
        }
    },
    "required": ["id", "fact"]
}

BUSINESS_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "default": SCHEMA_VERSION},
        "lastUpdated": {"type": "string", "format": "date-time"},
        "industry": {"type": "string"},
        "description": {"type": "string"},
        "services": {
            "type": "array",
            "items": {"type": "string"}
        },
        "facts": {
            "type": "array",
            "items": KNOWLEDGE_ENTRY_SCHEMA
        }
    },
    "required": ["version"]
}

PROCEDURE_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "name": {"type": "string"},
        "description": {"type": "string"},
        "steps": {
            "type": "array",
            "items": {"type": "string"}
        },
        "triggers": {
            "type": "array",
            "items": {"type": "string"}
        },
        "learnedAt": {"type": "string", "format": "date-time"}
    },
    "required": ["id", "name"]
}

PROCEDURES_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "default": SCHEMA_VERSION},
        "lastUpdated": {"type": "string", "format": "date-time"},
        "procedures": {
            "type": "array",
            "items": PROCEDURE_SCHEMA
        }
    },
    "required": ["version"]
}

INTERACTION_SCHEMA = {
    "type": "object",
    "properties": {
        "date": {"type": "string", "format": "date-time"},
        "summary": {"type": "string"},
        "sentiment": {
            "type": "string",
            "enum": ["positive", "neutral", "negative"]
        }
    },
    "required": ["date", "summary"]
}

PERSON_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "name": {"type": "string"},
        "relationship": {"type": "string"},
        "context": {"type": "string"},
        "interactions": {
            "type": "array",
            "items": INTERACTION_SCHEMA
        },
        "lastContact": {"type": "string", "format": "date-time"}
    },
    "required": ["id", "name"]
}

RELATIONSHIPS_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "default": SCHEMA_VERSION},
        "lastUpdated": {"type": "string", "format": "date-time"},
        "people": {
            "type": "array",
            "items": PERSON_SCHEMA
        }
    },
    "required": ["version"]
}

QUESTION_SCHEMA = {
    "type": "object",
    "properties": {
        "id": {"type": "string"},
        "question": {"type": "string"},
        "priority": {
            "type": "string",
            "enum": ["high", "medium", "low"]
        },
        "reason": {"type": "string"},
        "addedAt": {"type": "string", "format": "date-time"},
        "answer": {"type": "string"},
        "answeredAt": {"type": "string", "format": "date-time"}
    },
    "required": ["id", "question", "priority"]
}

QUESTIONS_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "default": SCHEMA_VERSION},
        "lastUpdated": {"type": "string", "format": "date-time"},
        "pending": {
            "type": "array",
            "items": QUESTION_SCHEMA
        },
        "answered": {
            "type": "array",
            "items": QUESTION_SCHEMA
        }
    },
    "required": ["version"]
}

# V2 schemas for new file types
PROFILE_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "default": SCHEMA_VERSION},
        "lastUpdated": {"type": "string", "format": "date-time"},
        "name": {"type": "string"},
        "timezone": {"type": "string"},
        "role": {"type": "string"},
        "industry": {"type": "string"}
    },
    "required": ["version"]
}

VOICE_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "default": SCHEMA_VERSION},
        "lastUpdated": {"type": "string", "format": "date-time"},
        "tone": {"type": "string"},
        "style": {"type": "string"},
        "personality": {"type": "array", "items": {"type": "string"}},
        "avoidWords": {"type": "array", "items": {"type": "string"}},
        "preferWords": {"type": "array", "items": {"type": "string"}}
    },
    "required": ["version"]
}

SERVICES_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "default": SCHEMA_VERSION},
        "lastUpdated": {"type": "string", "format": "date-time"},
        "services": {"type": "array", "items": {"type": "string"}},
        "specializations": {"type": "array", "items": {"type": "string"}}
    },
    "required": ["version"]
}

PRICING_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "default": SCHEMA_VERSION},
        "lastUpdated": {"type": "string", "format": "date-time"},
        "rates": {"type": "array"},
        "packages": {"type": "array"},
        "discounts": {"type": "array"}
    },
    "required": ["version"]
}

FAQS_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "default": SCHEMA_VERSION},
        "lastUpdated": {"type": "string", "format": "date-time"},
        "faqs": {"type": "array"}
    },
    "required": ["version"]
}

POLICIES_SCHEMA = {
    "type": "object",
    "properties": {
        "version": {"type": "integer", "default": SCHEMA_VERSION},
        "lastUpdated": {"type": "string", "format": "date-time"},
        "policies": {"type": "array"}
    },
    "required": ["version"]
}

# Map file names to schemas (V1 and V2)
SCHEMA_MAP = {
    # V2 identity/ files
    "profile": PROFILE_SCHEMA,
    "profile.md": PROFILE_SCHEMA,
    "voice": VOICE_SCHEMA,
    "voice.md": VOICE_SCHEMA,
    # V2 knowledge/ files
    "services": SERVICES_SCHEMA,
    "services.md": SERVICES_SCHEMA,
    "pricing": PRICING_SCHEMA,
    "pricing.md": PRICING_SCHEMA,
    "faqs": FAQS_SCHEMA,
    "faqs.md": FAQS_SCHEMA,
    "policies": POLICIES_SCHEMA,
    "policies.md": POLICIES_SCHEMA,
    # V1 legacy mappings
    "identity": PROFILE_SCHEMA,  # V1 identity → V2 profile schema
    "identity.md": PROFILE_SCHEMA,
    "boundaries": BOUNDARIES_SCHEMA,
    "boundaries.md": BOUNDARIES_SCHEMA,
    "patterns": PATTERNS_SCHEMA,
    "patterns.md": PATTERNS_SCHEMA,
    "contacts": CONTACTS_SCHEMA,
    "contacts.md": CONTACTS_SCHEMA,
    "business": SERVICES_SCHEMA,  # V1 business → V2 services schema
    "business.md": SERVICES_SCHEMA,
    "procedures": POLICIES_SCHEMA,  # V1 procedures → V2 policies schema
    "procedures.md": POLICIES_SCHEMA,
    "people": RELATIONSHIPS_SCHEMA,
    "people.md": RELATIONSHIPS_SCHEMA,
    "relationships": RELATIONSHIPS_SCHEMA,
    "questions": QUESTIONS_SCHEMA,
    "questions.md": QUESTIONS_SCHEMA,
}

# Default empty data for each schema type
DEFAULT_DATA = {
    # V2 identity/ files
    "profile": {
        "version": SCHEMA_VERSION,
        "name": "",
        "timezone": "",
        "role": "",
        "industry": ""
    },
    "voice": {
        "version": SCHEMA_VERSION,
        "tone": "professional-friendly",
        "style": "concise",
        "personality": [],
        "avoidWords": [],
        "preferWords": []
    },
    # V2 knowledge/ files
    "services": {
        "version": SCHEMA_VERSION,
        "services": [],
        "specializations": []
    },
    "pricing": {
        "version": SCHEMA_VERSION,
        "rates": [],
        "packages": [],
        "discounts": []
    },
    "faqs": {
        "version": SCHEMA_VERSION,
        "faqs": []
    },
    "policies": {
        "version": SCHEMA_VERSION,
        "policies": []
    },
    # V1 legacy (backward compat - map to V2 defaults)
    "identity": {
        "version": SCHEMA_VERSION,
        "name": "",
        "timezone": "",
        "role": "",
        "industry": ""
    },
    "boundaries": {
        "version": SCHEMA_VERSION,
        "neverDo": [],
        "alwaysDo": [],
        "escalateWhen": [],
        "limits": {}
    },
    "patterns": {
        "version": SCHEMA_VERSION,
        "communication": [],
        "work": [],
        "temporal": []
    },
    "contacts": {
        "version": SCHEMA_VERSION,
        "contacts": []
    },
    "business": {
        "version": SCHEMA_VERSION,
        "industry": "",
        "description": "",
        "services": [],
        "facts": []
    },
    "procedures": {
        "version": SCHEMA_VERSION,
        "procedures": []
    },
    "people": {
        "version": SCHEMA_VERSION,
        "people": []
    },
    "relationships": {
        "version": SCHEMA_VERSION,
        "people": []
    },
    "questions": {
        "version": SCHEMA_VERSION,
        "pending": [],
        "answered": []
    }
}


def get_schema(file_name: str) -> dict | None:
    """Get schema for a life file by name."""
    # Strip path and extension
    base_name = file_name.split("/")[-1].replace(".md", "")
    return SCHEMA_MAP.get(base_name) or SCHEMA_MAP.get(file_name)


def get_default_data(file_name: str) -> dict:
    """Get default empty data structure for a life file."""
    base_name = file_name.split("/")[-1].replace(".md", "")
    return DEFAULT_DATA.get(base_name, {"version": SCHEMA_VERSION}).copy()


def validate_data(file_name: str, data: dict) -> tuple[bool, list[str]]:
    """
    Validate data against schema.
    Returns (is_valid, list of error messages).

    Note: This is a simple validation without jsonschema dependency.
    For production, consider using jsonschema library.
    """
    errors = []
    schema = get_schema(file_name)

    if not schema:
        return True, []  # No schema = accept anything

    # Check required fields
    required = schema.get("required", [])
    for field in required:
        if field not in data:
            errors.append(f"Missing required field: {field}")

    # Check version
    if "version" in data and not isinstance(data["version"], int):
        errors.append("version must be an integer")

    return len(errors) == 0, errors
