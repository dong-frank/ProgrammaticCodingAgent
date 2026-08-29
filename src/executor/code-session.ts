export interface ProgramEdit {
    old_string: string;
    new_string: string;
    replace_all?: boolean;
}

export class CodeProgramSession {
    private source: string | null = null;
    private revision = 0;

    create(source: string): number {
        if (source.length === 0) {
            throw new Error("Agent Program 不能为空");
        }
        this.source = source;
        this.revision += 1;
        return this.revision;
    }

    edit(edits: ProgramEdit[], baseRevision: number): number {
        if (this.source === null) {
            throw new Error("当前没有可编辑的 Agent Program，请先使用 create");
        }
        if (baseRevision !== this.revision) {
            throw new Error(`程序版本冲突：当前版本为 ${this.revision}，提交版本为 ${baseRevision}`);
        }
        let updated = this.source;
        for (const edit of edits) {
            if (edit.old_string.length === 0) {
                throw new Error("old_string 必须是非空字符串");
            }
            const count = updated.split(edit.old_string).length - 1;
            if (count === 0) {
                throw new Error("当前 Agent Program 中未找到 old_string");
            }
            if (edit.replace_all !== true && count > 1) {
                throw new Error(`old_string 找到 ${count} 处匹配，请提供更精确的内容或设置 replace_all`);
            }
            updated = edit.replace_all === true
                ? updated.split(edit.old_string).join(edit.new_string)
                : updated.replace(edit.old_string, edit.new_string);
        }
        this.source = updated;
        this.revision += 1;
        return this.revision;
    }

    getSource(): string {
        if (this.source === null) {
            throw new Error("当前没有 Agent Program");
        }
        return this.source;
    }

    getRevision(): number {
        return this.revision;
    }
}
