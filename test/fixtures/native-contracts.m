#import "../../native/worker.m"
#import <stdbool.h>

static id currentManager;
static id currentDescriptor;

@interface SBIconController : NSObject
+ (id)sharedInstance;
- (id)iconManager;
@end
@implementation SBIconController
+ (id)sharedInstance { static SBIconController *instance; if (!instance) instance = [self new]; return instance; }
- (id)iconManager { return currentManager; }
@end

@interface ScalarGetter : NSObject
- (unsigned long)count;
- (id)value:(id)argument;
@end
@implementation ScalarGetter
- (unsigned long)count { return 1; }
- (id)value:(id)argument { return argument; }
@end

@interface FixtureDescriptor : NSObject
@property(nonatomic, copy) NSString *extension;
@property(nonatomic, copy) NSString *container;
- (id)kind;
- (id)extensionBundleIdentifier;
- (id)containerBundleIdentifier;
- (unsigned long)supportedFamilies;
@end
@implementation FixtureDescriptor
- (id)kind { return @"Kind"; }
- (id)extensionBundleIdentifier { return self.extension; }
- (id)containerBundleIdentifier { return self.container; }
- (unsigned long)supportedFamilies { return 1UL << 1; }
@end

@interface FixtureProvider : NSObject
- (id)sbh_descriptorsByExtensionIdentifier;
- (id)sbh_descriptorWithKind:(id)kind extensionBundleIdentifier:(id)extension containerBundleIdentifier:(id)container;
@end
@implementation FixtureProvider
- (id)sbh_descriptorsByExtensionIdentifier { return @{@"org.widgets": @[currentDescriptor]}; }
- (id)sbh_descriptorWithKind:(id)kind extensionBundleIdentifier:(id)extension containerBundleIdentifier:(id)container {
    (void)kind; (void)extension; (void)container;
    return currentDescriptor;
}
@end

@interface BaseManager : NSObject
- (id)widgetExtensionProvider;
- (void)_ensureWidgetIsVisibleForDebuggingWithDescriptor:(id)descriptor sizeClass:(long)size;
@end
@implementation BaseManager
- (id)widgetExtensionProvider { return [FixtureProvider new]; }
- (void)_ensureWidgetIsVisibleForDebuggingWithDescriptor:(id)descriptor sizeClass:(long)size { (void)descriptor; (void)size; }
@end

@interface MissingRemoveManager : BaseManager
- (void)revealIcon:(id)icon animated:(bool)animated completionHandler:(void (^)(void))completion;
@end
@implementation MissingRemoveManager
- (void)revealIcon:(id)icon animated:(bool)animated completionHandler:(void (^)(void))completion { (void)icon; (void)animated; (void)completion; }
@end

@interface MissingRevealManager : BaseManager
- (void)removeIcon:(id)icon options:(unsigned long long)options undoActionName:(id)name completion:(void (^)(void))completion;
@end
@implementation MissingRevealManager
- (void)removeIcon:(id)icon options:(unsigned long long)options undoActionName:(id)name completion:(void (^)(void))completion { (void)icon; (void)options; (void)name; (void)completion; }
@end

static void expectException(NSString *name, NSString *reason, void (^action)(void)) {
    BOOL rejected = NO;
    @try { action(); }
    @catch (NSException *exception) {
        if (![exception.name isEqual:name] || ![exception.reason containsString:reason]) @throw;
        rejected = YES;
    }
    if (!rejected) [NSException raise:@"HarnessFailure" format:@"Expected %@ containing %@", name, reason];
}

int main(void) {
    @autoreleasepool {
        @try {
            expectException(@"UnavailableABI", @"object getter", ^{ objectMessage([ScalarGetter new], "count"); });
            id controller = objectMessage(SBIconController.class, "sharedInstance");
            if (![controller isKindOfClass:SBIconController.class]) [NSException raise:@"HarnessFailure" format:@"Class singleton getter failed"];
            expectException(@"UnavailableABI", @"value:", ^{ requireMethod([ScalarGetter new], "value:", "@16@0:8"); });

            FixtureDescriptor *descriptor = [FixtureDescriptor new];
            descriptor.extension = @"org.widgets";
            descriptor.container = @"org.app";
            currentDescriptor = descriptor;
            currentManager = [MissingRemoveManager new];
            NSDictionary *desired = @{@"kind": @"Kind", @"extension": @"org.widgets", @"container": @"org.app", @"size": @"small"};
            id found = descriptorForWidget(currentManager, desired, NSMutableDictionary.dictionary);
            if (found != descriptor) [NSException raise:@"HarnessFailure" format:@"Matching descriptor rejected"];

            descriptor.extension = @"other.widgets";
            expectException(@"DescriptorMismatch", @"extension", ^{ descriptorForWidget(currentManager, desired, NSMutableDictionary.dictionary); });
            descriptor.extension = @"org.widgets";
            descriptor.container = @"other.app";
            expectException(@"DescriptorMismatch", @"container", ^{ descriptorForWidget(currentManager, desired, NSMutableDictionary.dictionary); });
            descriptor.container = @"org.app";

            NSDictionary *batch = @{@"targets": @[@{}], @"desired": desired};
            NSMutableDictionary *response = NSMutableDictionary.dictionary;
            expectException(@"UnavailableABI", @"removeIcon:", ^{ validateExistingWidgets(batch, response); });
            if (response[@"status"]) [NSException raise:@"HarnessFailure" format:@"Missing removal ABI published a status"];
            currentManager = [MissingRevealManager new];
            expectException(@"UnavailableABI", @"revealIcon:", ^{ validateExistingWidgets(batch, response); });
            if (response[@"status"]) [NSException raise:@"HarnessFailure" format:@"Missing reveal ABI published a status"];
            puts("native contracts: 8 checks passed");
            return 0;
        } @catch (NSException *exception) {
            fprintf(stderr, "%s: %s\n", exception.name.UTF8String, exception.reason.UTF8String);
            return 1;
        }
    }
}
