# frozen_string_literal: true

describe CategorySerializer do
  fab!(:group) { Fabricate(:group) }
  fab!(:category) { Fabricate(:category, reviewable_by_group_id: group.id) }

  it "includes the reviewable by group name if enabled" do
    SiteSetting.enable_category_group_moderation = true
    json = described_class.new(category, scope: Guardian.new, root: false).as_json
    expect(json[:reviewable_by_group_name]).to eq(group.name)
  end

  it "doesn't include the reviewable by group name if disabled" do
    SiteSetting.enable_category_group_moderation = false
    json = described_class.new(category, scope: Guardian.new, root: false).as_json
    expect(json[:reviewable_by_group_name]).to be_blank
  end

  it "includes custom fields" do
    json = described_class.new(category, scope: Guardian.new, root: false).as_json
    expect(json[:custom_fields]).to be_empty

    category.custom_fields["enable_marketplace"] = true
    category.save_custom_fields

    json = described_class.new(category, scope: Guardian.new, root: false).as_json
    expect(json[:custom_fields]).to be_present
  end

  it "does not include the default notification level when there is no user" do
    json = described_class.new(category, scope: Guardian.new, root: false).as_json
    expect(json.key?(:notification_level)).to eq(false)
  end

  describe "user notification level" do
    fab!(:user) { Fabricate(:user) }

    it "includes the user's notification level" do
      CategoryUser.set_notification_level_for_category(user, NotificationLevels.all[:watching], category.id)
      json = described_class.new(category, scope: Guardian.new(user), root: false).as_json
      expect(json[:notification_level]).to eq(NotificationLevels.all[:watching])
    end
  end

  describe "available groups" do
    fab!(:user) { Fabricate(:user) }
    fab!(:admin) { Fabricate(:admin) }

    it "not included for a regular user" do
      json = described_class.new(category, scope: Guardian.new(user), root: false).as_json
      expect(json[:available_groups]).to eq(nil)
    end

    it "included for an admin" do
      json = described_class.new(category, scope: Guardian.new(admin), root: false).as_json
      expect(json[:available_groups]).to eq(Group.order(:name).pluck(:name) - ['everyone'])
    end
  end
end
