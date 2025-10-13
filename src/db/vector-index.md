{
  "mappings": {
    "dynamic": false,
    "fields": {
      "embedding": { "type": "knnVector", "dimensions": 3072, "similarity": "cosine" },
      "documentId": { "type": "objectId" },
      "title": { "type": "string" },
      "tags": { "type": "string" },
      "visibility": { "type": "string" }
    }
  }
}
