import { defineConfig } from 'tinacms';

export default defineConfig({
  branch:
    process.env.GITHUB_BRANCH ||
    process.env.VERCEL_GIT_COMMIT_REF ||
    process.env.HEAD ||
    'main',
  clientId: process.env.NEXT_PUBLIC_TINA_CLIENT_ID || '',
  token: process.env.TINA_TOKEN || '',

  build: {
    publicFolder: 'public',
    outputFolder: 'admin/content',
  },

  media: {
    tina: {
      publicFolder: 'public',
      mediaRoot: 'uploads',
    },
  },

  schema: {
    collections: [
      {
        name: 'guide',
        label: 'Guides',
        path: 'content/guides',
        format: 'mdx',
        fields: [
          {
            type: 'string',
            name: 'title',
            label: 'Title',
            required: true,
            isTitle: true,
          },
          {
            type: 'string',
            name: 'description',
            label: 'Description',
          },
          {
            type: 'string',
            name: 'slug',
            label: 'Slug',
            required: true,
          },
          {
            type: 'string',
            name: 'category',
            label: 'Category',
            options: [
              'fashion',
              'bags-accessories',
              'jewelry',
              'beauty',
              'home',
              'food-drink',
              'crafts',
              'outdoor',
              'tech',
              'kids-pets',
            ],
          },
          {
            type: 'string',
            name: 'locale',
            label: 'Locale',
            required: true,
            options: ['zh-TW', 'en'],
          },
          {
            type: 'datetime',
            name: 'publishedAt',
            label: 'Published At',
          },
          {
            type: 'boolean',
            name: 'draft',
            label: 'Draft',
          },
          {
            type: 'string',
            name: 'sources',
            label: 'Sources',
            list: true,
          },
          {
            type: 'object',
            name: 'faq',
            label: 'FAQ',
            list: true,
            fields: [
              {
                type: 'string',
                name: 'q',
                label: 'Question',
              },
              {
                type: 'string',
                name: 'a',
                label: 'Answer',
              },
            ],
          },
          {
            type: 'rich-text',
            name: 'body',
            label: 'Body',
            isBody: true,
            templates: [
              {
                name: 'BrandCard',
                label: 'Brand Card',
                fields: [
                  {
                    type: 'string',
                    name: 'slug',
                    label: 'Brand Slug',
                    required: true,
                  },
                ],
              },
              {
                name: 'StatsCallout',
                label: 'Stats Callout',
                fields: [
                  {
                    type: 'string',
                    name: 'stat',
                    label: 'Stat',
                    required: true,
                  },
                  {
                    type: 'string',
                    name: 'label',
                    label: 'Label',
                    required: true,
                  },
                ],
              },
              {
                name: 'FaqBlock',
                label: 'FAQ Block',
                fields: [
                  {
                    type: 'object',
                    name: 'questions',
                    label: 'Questions',
                    list: true,
                    fields: [
                      {
                        type: 'string',
                        name: 'q',
                        label: 'Question',
                      },
                      {
                        type: 'string',
                        name: 'a',
                        label: 'Answer',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
});
