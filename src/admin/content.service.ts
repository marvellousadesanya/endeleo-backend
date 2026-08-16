// Editorial content: posts and per-project updates. Editor or admin only — the guard
// is on the controller, so nothing here re-checks roles.
import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "@/database/prisma.service";
import type { CreateProjectUpdateDto, UpsertPostDto } from "./dto/admin.dto";

@Injectable()
export class ContentService {
  constructor(private readonly prisma: PrismaService) {}

  /** Published posts only — this feeds unauthenticated pages. */
  listPublishedPosts() {
    return this.prisma.post.findMany({
      where: { status: "published" },
      orderBy: { publishedAt: "desc" },
      take: 50,
      select: { id: true, slug: true, title: true, excerpt: true, coverUrl: true, tag: true, publishedAt: true },
    });
  }

  /** Returns null rather than throwing: a missing post is a 404 page, not an error. */
  publishedBySlug(slug: string) {
    return this.prisma.post.findFirst({
      where: { slug, status: "published" },
      select: { id: true, slug: true, title: true, excerpt: true, body: true, coverUrl: true, tag: true, publishedAt: true },
    });
  }

  listPublicUpdates(projectSlug: string) {
    return this.prisma.projectUpdate.findMany({
      where: { projectSlug },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, title: true, body: true, createdAt: true },
    });
  }

  listPosts() {
    return this.prisma.post.findMany({ orderBy: { updatedAt: "desc" }, take: 200 });
  }

  /**
   * Accepts either the uuid or the slug. The admin editor routes by id while the
   * public-facing paths use the slug, and forcing one on the other buys nothing.
   */
  async getPost(idOrSlug: string) {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug);
    const post = await this.prisma.post.findFirst({
      where: isUuid ? { id: idOrSlug } : { slug: idOrSlug },
    });
    if (!post) throw new NotFoundException("Post not found");
    return post;
  }

  /**
   * publishedAt is stamped the first time a post goes live and never moved afterwards,
   * so re-publishing an edit does not reorder the archive.
   */
  async upsertPost(dto: UpsertPostDto, authorId: string) {
    const existing = await this.prisma.post.findUnique({
      where: { slug: dto.slug },
      select: { publishedAt: true },
    });

    const publishedAt =
      dto.status === "published" ? (existing?.publishedAt ?? new Date()) : existing?.publishedAt ?? null;

    const data = {
      title: dto.title,
      excerpt: dto.excerpt ?? "",
      body: dto.body ?? "",
      tag: dto.tag ?? "",
      coverUrl: dto.coverUrl ?? "",
      status: dto.status,
      publishedAt,
    };

    return this.prisma.post.upsert({
      where: { slug: dto.slug },
      create: { slug: dto.slug, authorId, ...data },
      update: data,
    });
  }

  async deletePost(id: string) {
    await this.prisma.post.deleteMany({ where: { id } });
    return { ok: true };
  }

  listProjectUpdates(projectSlug?: string) {
    return this.prisma.projectUpdate.findMany({
      where: projectSlug ? { projectSlug } : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  createProjectUpdate(dto: CreateProjectUpdateDto, authorId: string) {
    return this.prisma.projectUpdate.create({
      data: {
        projectSlug: dto.projectSlug,
        title: dto.title,
        body: dto.body ?? "",
        authorId,
      },
    });
  }

  async deleteProjectUpdate(id: string) {
    await this.prisma.projectUpdate.deleteMany({ where: { id } });
    return { ok: true };
  }
}
